#[cfg(not(debug_assertions))]
use std::io::{BufRead, BufReader, Write};
#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(not(debug_assertions))]
use std::path::{Path, PathBuf};
#[cfg(not(debug_assertions))]
use std::process::{Child, Command, Stdio};
#[cfg(not(debug_assertions))]
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::sleep;
#[cfg(not(debug_assertions))]
use std::time::Instant;
use std::time::Duration;

use tauri::Emitter;
use tauri::Listener;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
#[cfg(not(debug_assertions))]
use tauri::path::BaseDirectory;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

// 菜单栏番茄钟（状态栏常驻图标 + 实时倒计时 + 快捷菜单 + 原生通知）
mod tray;
use serde_json::json;

/// 浏览器剪藏深链（lectoforge://capture?url=&title=&text=）的待消费缓冲。
///
/// macOS 通过自定义 URL Scheme 拉起应用时，`RunEvent::Opened` 可能在前端
/// `listen("deep-link")` 注册之前就触发（冷启动场景），直接 `emit` 会丢事件。
/// 因此 Rust 侧把解析后的深链暂存在这里，既 `emit` 给已在监听的前端，
/// 也允许前端 `onMounted` 后通过 `take_pending_deep_link` 命令再来取一次兜底，
/// 两条路径任一命中即可，保证剪藏内容不丢失。
struct DeepLinkState {
    pending: Mutex<Option<serde_json::Value>>,
}

const DEFAULT_BACKEND_PORT: u16 = 8787;

/// 实际生效的后端端口。正常恒为 8787（启动时 `free_port` + `pick_free_port` 会强行腾出该端口），
/// 但兜底顺延时会变；`#[tauri::command]` 拿不到 setup 里的局部变量，所以用原子量做全局桥接。
static API_PORT: std::sync::atomic::AtomicU16 =
    std::sync::atomic::AtomicU16::new(DEFAULT_BACKEND_PORT);

/// 注入给 Node 侧车的数据目录环境变量名（与 src-api/src/lib/paths.ts 的 DATA_DIR_ENV 一致）
#[cfg(not(debug_assertions))]
const DATA_DIR_ENV: &str = "LECTOFORGE_DATA_DIR";
/// 注入给 Node 侧车的离线模型资源目录环境变量名（与 paths.ts 的 RESOURCES_DIR_ENV 一致）
#[cfg(not(debug_assertions))]
const RESOURCES_DIR_ENV: &str = "LECTOFORGE_RESOURCES_DIR";
/// 产品更名前（KnowFlow）的旧 bundle identifier。
///
/// AppData 目录名 = bundle identifier，改名后系统解析到的是一个全新的空目录，
/// 老用户的 workbench.db / mindmaps / uploads 会被「留在原地读不到」，表现为数据凭空消失。
/// 这里保留旧名用于一次性迁移，迁移完成后仍**不删除**旧目录（留作回滚安全网）。
#[cfg(not(debug_assertions))]
const LEGACY_APP_IDENTIFIER: &str = "com.knowflow.desktop";
/// 侧车异常退出后的基础重启间隔
#[cfg(not(debug_assertions))]
const RESTART_BASE_DELAY: Duration = Duration::from_secs(2);
/// 连续闪退时的重启间隔上限（避免每 2 秒 fork 一次形成事实上的进程炸弹）
#[cfg(not(debug_assertions))]
const RESTART_MAX_DELAY: Duration = Duration::from_secs(30);
/// 子进程存活超过该时长即视为「这次起来了」，退避计时归零
#[cfg(not(debug_assertions))]
const HEALTHY_UPTIME: Duration = Duration::from_secs(30);
/// 侧车日志文件大小上限，超过则在下次启动时清空
#[cfg(not(debug_assertions))]
const LOG_MAX_BYTES: u64 = 4 * 1024 * 1024;

/// 共享状态：复习提醒开关（菜单可切换，后台调度线程读取）
struct AppState {
    // 由 manage 托管供后续 Tauri 命令读取，调度线程另持有同一个 Arc
    #[allow(dead_code)]
    reminder_enabled: Arc<Mutex<bool>>,
}

// =============================================================================
// Node 侧车进程管理器
//
// 设计要点（都是踩过坑之后的硬性约束）：
// 1. 用 std::process::Command 直接拉起，不再走 tauri-plugin-shell 的 sidecar API——
//    只有拿到裸 Child 才能自己掌控 wait / kill / 重启的完整生命周期。
// 2. 数据目录由宿主用 BaseDirectory::AppData 解析并 create_dir_all 后，
//    以环境变量 LECTOFORGE_DATA_DIR 注入子进程；.app 包内只读，绝不能让后端写包内路径。
// 3. 监控放在独立线程里阻塞 wait()，Tauri 主线程一秒都不能被挡住。
// 4. 重启必须复用同一个端口：窗口页面的 origin 就是 http://127.0.0.1:<port>，
//    换端口 = 前端永远连不回来。因此重启前先等端口被释放。
// 5. 不存 Child 而存 pid：Child::wait() 要 &mut self，监控线程若持锁阻塞在 wait 上，
//    退出时想 kill 就会死锁；kill 走 pid + 系统 kill 命令，不引入任何额外依赖。
// =============================================================================

/// 侧车启动参数（重启时原样复用）
#[cfg(not(debug_assertions))]
#[derive(Clone)]
struct SidecarSpec {
    /// Node 可执行文件（Tauri externalBin 打进 Contents/MacOS/server）
    node_bin: PathBuf,
    /// 后端入口脚本 Contents/Resources/api/index.js
    entry: PathBuf,
    /// 前端构建产物 Contents/Resources/web
    web_dir: PathBuf,
    /// 可写数据目录 ~/Library/Application Support/<identifier>
    data_dir: PathBuf,
    /// 离线模型资源目录 Contents/Resources（tesseract / whisper 的 wasm / 语言包 / 模型）
    resources_dir: PathBuf,
    /// 宿主协商好的固定端口
    port: u16,
    /// 侧车日志文件 <data_dir>/logs/sidecar.log
    log_file: PathBuf,
}

#[cfg(not(debug_assertions))]
struct SidecarManager {
    spec: SidecarSpec,
    app: tauri::AppHandle,
    /// 当前子进程 pid（None 表示进程不在）
    pid: Arc<Mutex<Option<u32>>>,
    /// 应用退出中：置位后监控线程不再重启
    stopping: Arc<AtomicBool>,
    /// 已重启次数（仅用于日志与事件上报）
    restarts: Arc<AtomicU32>,
}

#[cfg(not(debug_assertions))]
impl SidecarManager {
    fn new(app: tauri::AppHandle, spec: SidecarSpec) -> Self {
        Self {
            spec,
            app,
            pid: Arc::new(Mutex::new(None)),
            stopping: Arc::new(AtomicBool::new(false)),
            restarts: Arc::new(AtomicU32::new(0)),
        }
    }

    /// 拉起一个新的 Node 子进程（含环境变量注入与日志管道接管）
    fn spawn_process(&self) -> std::io::Result<Child> {
        let mut cmd = Command::new(&self.spec.node_bin);
        cmd.arg(&self.spec.entry)
            .arg("--port")
            .arg(self.spec.port.to_string())
            .arg("--web-dir")
            .arg(&self.spec.web_dir)
            // --data-dir 与环境变量同时给：老版本后端只认参数，新版本优先认环境变量
            .arg("--data-dir")
            .arg(&self.spec.data_dir)
            .env(DATA_DIR_ENV, &self.spec.data_dir)
            // 离线模型资源目录：前端经 /models/* 同源拉取 tesseract / whisper 资产
            .env(RESOURCES_DIR_ENV, &self.spec.resources_dir)
            .env("LECTOFORGE_PORT", self.spec.port.to_string())
            .env("NODE_ENV", "production")
            // 工作目录设成可写的数据目录：万一有库按相对路径落盘，也不会写进只读的 .app
            .current_dir(&self.spec.data_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn()?;
        if let Some(out) = child.stdout.take() {
            pipe_logs(out, "out", self.spec.log_file.clone());
        }
        if let Some(err) = child.stderr.take() {
            pipe_logs(err, "err", self.spec.log_file.clone());
        }
        Ok(child)
    }

    /// 启动侧车监控线程：拉起 → 阻塞 wait → 异常退出则退避重启，无限循环。
    ///
    /// 线程模型：本函数**不阻塞**调用方，内部 `spawn` 一条分离线程持有 `Arc<Self>`；
    /// 就绪探测再单独开一条线程，绝不能放在监控线程里，否则 `child.wait()` 被推迟，
    /// 侧车崩溃时无法第一时间感知。
    ///
    /// # 退避策略
    /// - 基础间隔 `RESTART_BASE_DELAY`(2s)，每次失败经 `next_delay` 递增，
    ///   上限 `RESTART_MAX_DELAY`(30s)。不设上限的话连续闪退会变成每 2 秒 fork 一次的进程炸弹。
    /// - 子进程存活超过 `HEALTHY_UPTIME`(30s) 视为「这次真起来了」，退避计时归零。
    ///   区分「启动就崩」和「跑着跑着崩」很重要：后者往往是偶发 OOM，
    ///   没必要让用户等 30 秒才恢复。
    /// - 退出码为 0 时**不重启**并广播 `sidecar://stopped`。这是后端孤儿自检发现宿主
    ///   已消失后的主动退出，重启只会立刻再退一次。
    /// - `st.code()` 在进程被信号杀死（如 OOM 的 SIGKILL）时返回 `None`，一律按异常处理。
    ///
    /// # ⚠️ 为什么端口必须固定，端口漂移会导致「断线重连失联」
    /// 后端在遇到 `EADDRINUSE` 时会自行把端口 +1 漂移，这在纯命令行下是好事，
    /// 在本应用里却是致命的，原因有两条相互独立的链路：
    ///
    /// 1. **ACL / Remote 来源不匹配。** 窗口加载的是 `http://127.0.0.1:8787`，
    ///    对 Tauri 而言属于「远程来源」，必须在 `capabilities/*.json` 里用
    ///    `remote.urls` 显式声明可信来源，而那份声明是**写死 8787** 的静态配置。
    ///    侧车一旦漂到 8788，窗口 URL 随之改变，origin 与 capability 不再匹配，
    ///    所有自定义命令会被 ACL 静默拒绝——表现为「dev 正常、打包后按钮全不响应」。
    ///
    /// 2. **前端持有的 baseURL 不会跟着变。** 前端在首帧就固化了 API 基址；
    ///    重启后侧车换了端口，健康探测 `wait_for_backend` 打的是**旧端口**，
    ///    可能恰好探到上一条尚未完全释放的残留监听而误报「已就绪」，
    ///    而真正的新实例在另一个端口上无人连接。此时进程活着、日志正常、
    ///    托盘也不报错，但界面所有请求 `ECONNREFUSED`，即「重连失联」——
    ///    最难排查的一种故障形态。
    ///
    /// 因此循环体开头必须先 `wait_port_released` 等旧监听套接字彻底释放（最多 10s）
    /// 再拉新进程；启动阶段则由 `free_port` + `pick_free_port` 保证 8787 一定可用
    /// （8787 是本应用专用端口，占着它的只可能是自家残留侧车，强杀风险可控）。
    /// 等待超时也仍然尝试启动，是两害相权：拿不到端口至少还有重试机会，
    /// 卡在这里则永远不会恢复。
    fn supervise(self: &Arc<Self>) {
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            let mut delay = RESTART_BASE_DELAY;

            loop {
                if this.stopping.load(Ordering::SeqCst) {
                    break;
                }

                /* 端口必须是自己的。上一条实例刚被杀，监听套接字可能还没彻底释放，
                 * 此时抢着起新进程会撞 EADDRINUSE，后端要么退出要么漂到别的端口。 */
                if !wait_port_released(this.spec.port, Duration::from_secs(10)) {
                    eprintln!(
                        "[lectoforge] 端口 {} 迟迟未释放，仍尝试启动侧车",
                        this.spec.port
                    );
                }

                let started = Instant::now();
                let mut child = match this.spawn_process() {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[lectoforge] 侧车启动失败: {e}");
                        sleep(delay);
                        delay = next_delay(delay);
                        continue;
                    }
                };

                let pid = child.id();
                *this.pid.lock().unwrap() = Some(pid);
                let generation = this.restarts.load(Ordering::SeqCst);
                println!(
                    "[lectoforge] 侧车已启动 pid={pid} port={} 第 {generation} 次",
                    this.spec.port
                );

                // 就绪探测另开线程，绝不能挡住下面的 wait()
                {
                    let app = this.app.clone();
                    let port = this.spec.port;
                    std::thread::spawn(move || {
                        if wait_for_backend(port) {
                            let _ = app.emit(
                                "sidecar://ready",
                                json!({ "port": port, "pid": pid, "generation": generation }),
                            );
                        }
                    });
                }

                // 阻塞等待子进程结束——本线程是分离出来的，主线程不受影响
                let status = child.wait();
                *this.pid.lock().unwrap() = None;

                if this.stopping.load(Ordering::SeqCst) {
                    println!("[lectoforge] 应用退出中，侧车监控结束");
                    break;
                }

                let (code, abnormal) = match &status {
                    // code() 在被信号杀死时返回 None（如 OOM 的 SIGKILL），一律按异常处理
                    Ok(st) => (st.code(), !st.success()),
                    Err(e) => {
                        eprintln!("[lectoforge] 等待侧车退出时出错: {e}");
                        (None, true)
                    }
                };

                if !abnormal {
                    /* 退出码 0：后端自己决定停下（例如孤儿自检发现宿主没了）。
                     * 这种情况重启没有意义，交给下次启动应用处理。 */
                    println!("[lectoforge] 侧车正常退出（code=0），不再重启");
                    let _ = this.app.emit("sidecar://stopped", json!({ "code": 0 }));
                    break;
                }

                let uptime = started.elapsed();
                eprintln!(
                    "[lectoforge] 侧车异常退出 code={:?}，存活 {:?}，{:?} 后重启",
                    code, uptime, delay
                );
                let _ = this.app.emit(
                    "sidecar://down",
                    json!({ "code": code, "uptimeMs": uptime.as_millis() as u64 }),
                );

                // 活过 30 秒说明这次是「跑着跑着崩的」，不是启动就崩，退避重新计时
                if uptime >= HEALTHY_UPTIME {
                    delay = RESTART_BASE_DELAY;
                }

                sleep(delay);
                delay = next_delay(delay);
                this.restarts.fetch_add(1, Ordering::SeqCst);
            }
        });
    }

    /// 应用退出时回收侧车：先 SIGTERM 给它清理的机会，2 秒内没走再 SIGKILL。
    /// 不回收的话侧车会变成孤儿进程常驻后台，端口一直被占，
    /// 反复开关几次就会堆积出一串各占上百 MB 的僵尸后端。
    fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        let pid = match *self.pid.lock().unwrap() {
            Some(p) => p,
            None => return,
        };
        println!("[lectoforge] 正在回收侧车 pid={pid}");
        signal_process(pid, false);

        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if !process_alive(pid) {
                return;
            }
            sleep(Duration::from_millis(100));
        }
        eprintln!("[lectoforge] 侧车未响应 SIGTERM，强制结束 pid={pid}");
        signal_process(pid, true);
    }
}

// =============================================================================
// 本地 Whisper 语音识别侧车（离线 STT）
//
// 模拟面试功能把用户的语音先经前端 MediaRecorder 录成音频，POST 到后端
// whisperSttService，由后端转发给本地 whisper-server(:8080) 做离线语音转文字。
// 这里负责在生产构建里把 whisper-server 作为独立进程拉起并监督。
//
// ⚠️ 构建安全：whisper-server 二进制【不】进 externalBin（体积大、开发者机器未必有），
//    因此二进制或模型缺失时**静默跳过**——不崩溃、不影响主窗口与后端。用户需自行放置
//    二进制+模型（见 scripts/run-whisper.sh），或配置环境变量 WHISPER_BIN/WHISPER_MODEL。
// =============================================================================

#[cfg(not(debug_assertions))]
struct WhisperSidecar {
    bin: PathBuf,
    model: PathBuf,
    port: u16,
    threads: u16,
    log_file: PathBuf,
    pid: Arc<Mutex<Option<u32>>>,
    stopping: Arc<AtomicBool>,
}

#[cfg(not(debug_assertions))]
impl WhisperSidecar {
    /// 解析 whisper-server 二进制与模型路径；任一缺失返回 None（调用方静默跳过）。
    fn resolve(resource_dir: &Path) -> Option<Self> {
        let bin = if let Ok(p) = std::env::var("WHISPER_BIN") {
            PathBuf::from(p)
        } else {
            // 随包落在 Contents/Resources/models/whisper-server（scripts/fetch-models.sh 负责下载）
            resource_dir.join("models").join("whisper-server")
        };
        if !bin.exists() {
            eprintln!(
                "[lectoforge] 未找到 whisper-server 二进制（{}），跳过本地 STT 侧车；\
                 面试语音识别需手动启动 whisper-server 或改用系统语音识别。",
                bin.display()
            );
            return None;
        }
        let model = if let Ok(p) = std::env::var("WHISPER_MODEL") {
            PathBuf::from(p)
        } else {
            resource_dir.join("models").join("ggml-base.bin")
        };
        if !model.exists() {
            eprintln!(
                "[lectoforge] 未找到 whisper 模型（{}），跳过本地 STT 侧车。",
                model.display()
            );
            return None;
        }
        let data_dir = std::env::var("LECTOFORGE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| resource_dir.to_path_buf());
        let log_dir = data_dir.join("logs");
        let _ = std::fs::create_dir_all(&log_dir);
        let threads = std::thread::available_parallelism()
            .map(|n| n.get() as u16)
            .unwrap_or(8);
        Some(Self {
            bin,
            model,
            port: 8080,
            threads,
            log_file: log_dir.join("whisper.log"),
            pid: Arc::new(Mutex::new(None)),
            stopping: Arc::new(AtomicBool::new(false)),
        })
    }

    fn spawn_process(&self) -> std::io::Result<Child> {
        let mut cmd = Command::new(&self.bin);
        cmd.arg("-m")
            .arg(&self.model)
            .arg("--port")
            .arg(self.port.to_string())
            .arg("-t")
            .arg(self.threads.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn()?;
        if let Some(out) = child.stdout.take() {
            pipe_logs(out, "whisper-out", self.log_file.clone());
        }
        if let Some(err) = child.stderr.take() {
            pipe_logs(err, "whisper-err", self.log_file.clone());
        }
        Ok(child)
    }

    /// 监督线程：拉起 → 阻塞 wait → 异常退出则退避重启（复用 SidecarManager 的退避工具）。
    fn supervise(self: &Arc<Self>) {
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            let mut delay = RESTART_BASE_DELAY;
            loop {
                if this.stopping.load(Ordering::SeqCst) {
                    break;
                }
                let mut child = match this.spawn_process() {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[lectoforge] whisper-server 启动失败: {e}");
                        sleep(delay);
                        delay = next_delay(delay);
                        continue;
                    }
                };
                let pid = child.id();
                *this.pid.lock().unwrap() = Some(pid);
                println!(
                    "[lectoforge] whisper-server 已启动 pid={pid} port={}",
                    this.port
                );
                let status = child.wait();
                *this.pid.lock().unwrap() = None;
                if this.stopping.load(Ordering::SeqCst) {
                    break;
                }
                let abnormal = match &status {
                    Ok(st) => !st.success(),
                    Err(_) => true,
                };
                if !abnormal {
                    println!("[lectoforge] whisper-server 正常退出，不再重启");
                    break;
                }
                eprintln!("[lectoforge] whisper-server 异常退出，{:?} 后重启", delay);
                sleep(delay);
                delay = next_delay(delay);
            }
        });
    }

    fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        if let Some(pid) = *self.pid.lock().unwrap() {
            signal_process(pid, false);
        }
    }
}

/// 重启间隔翻倍，封顶 RESTART_MAX_DELAY
#[cfg(not(debug_assertions))]
fn next_delay(current: Duration) -> Duration {
    std::cmp::min(current * 2, RESTART_MAX_DELAY)
}

/// 给指定 pid 发信号（force = true 时 SIGKILL）。
/// 只用系统自带命令，避免为了一次 kill 引入 libc 依赖。
#[cfg(not(debug_assertions))]
fn signal_process(pid: u32, force: bool) {
    #[cfg(unix)]
    {
        let sig = if force { "-9" } else { "-15" };
        let _ = Command::new("/bin/kill")
            .arg(sig)
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.arg("/PID").arg(pid.to_string()).arg("/T");
        if force {
            cmd.arg("/F");
        }
        let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
}

/// 进程是否还活着（kill -0 只做权限与存在性检查，不真的发信号）
#[cfg(not(debug_assertions))]
fn process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        Command::new("/bin/kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        Command::new("tasklist")
            .arg("/FI")
            .arg(format!("PID eq {pid}"))
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
}

/// 等待端口重新可绑定，最长 timeout。返回 true 表示端口已空闲。
#[cfg(not(debug_assertions))]
fn wait_port_released(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        sleep(Duration::from_millis(150));
    }
}

/// 把子进程的 stdout/stderr 逐行转发到宿主控制台，并落盘到 <data>/logs/sidecar.log。
/// 打包后的 .app 从 Finder 启动是没有控制台的，日志文件是唯一的排查线索。
#[cfg(not(debug_assertions))]
fn pipe_logs<R: std::io::Read + Send + 'static>(reader: R, tag: &'static str, log_file: PathBuf) {
    std::thread::spawn(move || {
        let mut buf = BufReader::new(reader);
        let mut raw: Vec<u8> = Vec::with_capacity(256);
        loop {
            raw.clear();
            match buf.read_until(b'\n', &mut raw) {
                Ok(0) => break,
                Ok(_) => {
                    let text = String::from_utf8_lossy(&raw);
                    let text = text.trim_end_matches(['\r', '\n']);
                    if tag == "err" {
                        eprintln!("[lectoforge-api] {text}");
                    } else {
                        println!("[lectoforge-api] {text}");
                    }
                    append_log(&log_file, tag, text);
                }
                Err(_) => break,
            }
        }
    });
}

#[cfg(not(debug_assertions))]
fn append_log(path: &Path, tag: &str, line: &str) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{stamp} [{tag}] {line}");
    }
}

/// 递归复制目录内容（仅用于数据迁移，遇到单个文件失败只跳过、不中断整体迁移）。
#[cfg(not(debug_assertions))]
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<u64> {
    let mut copied = 0u64;
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copied += copy_dir_recursive(&from, &to).unwrap_or(0);
        } else {
            // 目标已存在则保留目标（新数据优先），避免二次运行把用户新写的内容覆盖回去
            if !to.exists() {
                match std::fs::copy(&from, &to) {
                    Ok(_) => copied += 1,
                    Err(e) => eprintln!("[lectoforge] 迁移跳过 {}: {e}", from.display()),
                }
            }
        }
    }
    Ok(copied)
}

/// KnowFlow → LectoForge 更名后的一次性数据迁移。
///
/// bundle identifier 变了 ⇒ `BaseDirectory::AppData` 指向一个全新的空目录。
/// 若新目录尚无主库、而旧目录里有，就把旧目录整体复制过来（**不删除**旧目录，
/// 万一迁移出问题还能手工回退）。已迁移过则因主库存在而直接跳过，幂等。
#[cfg(not(debug_assertions))]
fn migrate_legacy_data_dir(new_dir: &Path) {
    const DB_FILE: &str = "workbench.db";
    // 新目录已有主库 = 要么已迁移过，要么是新装用户自己用出来的数据，一律不动
    if new_dir.join(DB_FILE).exists() {
        return;
    }
    let Some(legacy_dir) = new_dir.parent().map(|p| p.join(LEGACY_APP_IDENTIFIER)) else {
        return;
    };
    if legacy_dir == new_dir || !legacy_dir.join(DB_FILE).exists() {
        return;
    }
    println!(
        "[lectoforge] 检测到更名前的数据目录，开始迁移: {} → {}",
        legacy_dir.display(),
        new_dir.display()
    );
    match copy_dir_recursive(&legacy_dir, new_dir) {
        Ok(n) => println!("[lectoforge] 历史数据迁移完成，共 {n} 个文件（旧目录已保留，确认无误后可自行删除）"),
        Err(e) => eprintln!("[lectoforge] 历史数据迁移失败: {e}（旧数据仍在 {}）", legacy_dir.display()),
    }
}

/// 定位 Node 侧车可执行文件。
/// macOS 打包后 externalBin 会被放进 Contents/MacOS/ 且去掉目标三元组后缀，
/// 但为防不同 Tauri 版本行为差异，这里按候选顺序逐个探测。
#[cfg(not(debug_assertions))]
fn resolve_node_bin(resource_dir: &Path) -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("LECTOFORGE_NODE_BIN") {
        let p = PathBuf::from(custom);
        if p.exists() {
            return Some(p);
        }
    }
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let triple = format!(
        "{}-{}",
        std::env::consts::ARCH,
        if cfg!(target_os = "macos") {
            "apple-darwin"
        } else if cfg!(target_os = "windows") {
            "pc-windows-msvc"
        } else {
            "unknown-linux-gnu"
        }
    );
    let candidates = [
        exe_dir.join("server"),
        exe_dir.join(format!("server-{triple}")),
        exe_dir.join("server.exe"),
        resource_dir.join("server"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

/// 主窗口「无边框沉浸式外壳」的统一样式入口（2026-08-10）。
///
/// 为什么抽成函数：主窗口在 release / debug 两个 `#[cfg]` 分支里各建一次（连的 URL 不同），
/// 窗口外观参数必须逐字一致，否则会出现「dev 好看、打包后多一条原生标题栏」这类
/// 只能靠肉眼比对才能发现的偏差。集中一处后，改外观只需改这里。
///
/// ⚠️ 注意：本项目 `tauri.conf.json` 的 `app.windows` 是**空数组**——窗口完全由这里
/// 程序化创建。往 conf 的 windows 里写 `decorations/transparent` 不会生效，别走错地方。
///
/// 各参数的取舍：
/// - `decorations(false)`：干掉 macOS 原生标题栏。原生红黄绿与标题条一并消失，
///   由前端 `WindowControls.vue` 自绘补回，顶栏（DesktopTopNav）自此直接贴到窗口最顶边。
/// - `transparent(true)`：让 WKWebView 背景可透。依赖 `macOSPrivateApi: true`（tauri.conf.json）
///   与 Cargo feature `macos-private-api`，两者本项目均已开启，缺一会在运行时 panic。
///   页面侧由 `style.css` 的 `html/body` 兜底色保证不会真的透出桌面。
/// - `shadow(true)`：`decorations(false)` 会让 macOS 连窗口投影一起收走，窗口边缘会「糊」在
///   桌面上。显式要回系统投影，比在 CSS 里画假阴影真实得多（CSS 阴影画在窗口内部，
///   只会挤占内容区，不可能溢出到窗口之外）。
/// - `resizable(true)`：无边框窗口仍保留 `NSWindowStyleMask::Resizable`，四边可拖拽缩放；
///   显式声明是为了防止后来者以为无边框就等于固定尺寸。
/// - `min_inner_size`：顶栏在 <lg 断点会把「复习/费曼故事/思维导图/规划」折进「更多」下拉，
///   再窄就只剩挤成一团的图标；给个下限省得用户把窗口拖成一条缝后找不回来。
fn apply_shell_style<'a, R: tauri::Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
        .inner_size(1200.0, 800.0)
        .min_inner_size(960.0, 640.0)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .resizable(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 后端实际监听端口：生产由宿主协商后写入，开发固定用默认值（dev:api 监听它）
            #[allow(unused_mut, unused_assignments)]
            let mut api_port: u16 = DEFAULT_BACKEND_PORT;

            /* 激活策略保持默认的 Regular（有 Dock 图标、可 ⌘Tab、显示应用主菜单）。
             *
             * 2026-08-08 形态回归：番茄钟由「独立菜单栏弹窗应用」改为「主工作台内嵌胶囊 +
             * 菜单栏倒计时指示器」。此前为纯菜单栏形态设过 ActivationPolicy::Accessory，
             * 现在必须去掉——Accessory 下 macOS 不展示应用主菜单栏，而 WKWebView 的
             * ⌘C/⌘V 依赖原生「编辑」菜单里的 copy:/paste: selector 接入响应链，
             * 保留 Accessory 会让主窗口输入框的复制粘贴静默失效。 */

            // 深链剪藏的待消费缓冲（lectoforge://capture 拉起时写入，前端监听或命令兜底取用）
            app.manage(DeepLinkState {
                pending: Mutex::new(None),
            });

            // 1) 打开主窗口（生产起 Node 侧车，开发加载 vite）
            #[cfg(not(debug_assertions))]
            {
                let resolver = app.path();
                let resource_dir = resolver.resource_dir()?;
                let web_dir = resource_dir.join("web");
                let api_index = resource_dir.join("api").join("index.js");

                /* ===== 任务 A：可写数据目录解析与注入 =====
                 * BaseDirectory::AppData 在 macOS 下解析为
                 *   ~/Library/Application Support/<bundle identifier>
                 * 即 ~/Library/Application Support/com.lectoforge.desktop。
                 * resolve("") 会带一个尾随分隔符，用 components() 归一化掉，日志才干净。 */
                let data_dir: std::path::PathBuf = resolver
                    .resolve("", BaseDirectory::AppData)?
                    .components()
                    .collect();
                std::fs::create_dir_all(&data_dir)?;
                // KnowFlow → LectoForge 更名：把旧 identifier 目录下的历史数据搬过来
                migrate_legacy_data_dir(&data_dir);
                let log_dir = data_dir.join("logs");
                std::fs::create_dir_all(&log_dir)?;
                let log_file = log_dir.join("sidecar.log");
                // 日志超过上限就重开一份，别让它无限长大
                if std::fs::metadata(&log_file).map(|m| m.len()).unwrap_or(0) > LOG_MAX_BYTES {
                    let _ = std::fs::remove_file(&log_file);
                }
                println!("[lectoforge] 数据目录: {}", data_dir.display());

                /* 端口必须由宿主先协商好再传给侧车。
                 * 后端在 EADDRINUSE 时会自行 +1 漂移，若这里仍写死 8787，
                 * 一旦上一次的实例没退干净，窗口就会连到那个陈旧服务上（它托管的是
                 * 已被替换掉的旧构建产物），页面会卡在加载态。
                 *
                 * 关键：capability 的 remote 可信来源写死 http://127.0.0.1:8787，
                 * 因此窗口必须始终连到 8787，否则 Tauri 的 IPC/ACL 会因 origin 不匹配而
                 * 拒绝自定义命令（菜单栏倒计时推不出去等）。启动前先释放被上一次没退干净的
                 * 侧车占住的 8787，确保 pick_free_port 永远返回 8787。 */
                free_port(DEFAULT_BACKEND_PORT);
                let port = pick_free_port(DEFAULT_BACKEND_PORT);

                let node_bin = resolve_node_bin(&resource_dir)
                    .expect("未找到 Node 侧车可执行文件，请先运行 scripts/prepare-bin.sh");

                let spec = SidecarSpec {
                    node_bin,
                    entry: api_index,
                    web_dir,
                    data_dir,
                    // Tauri 的 resource_dir() 即 .app 内 Contents/Resources，模型随包落在 <resources>/models
                    // 注意：下方 792 行 WhisperSidecar::resolve(&resource_dir) 仍需借用原始值，
                    // 故此处 clone 一份，避免把 resource_dir 整体 move 走导致后续借用失效。
                    resources_dir: resource_dir.clone(),
                    port,
                    log_file,
                };
                let manager = Arc::new(SidecarManager::new(app.handle().clone(), spec));
                manager.supervise();
                app.manage(Arc::clone(&manager));

                // 本地 Whisper STT 侧车（离线语音转文字）：二进制/模型缺失时自动跳过，不影响主流程
                if let Some(ws) = WhisperSidecar::resolve(&resource_dir) {
                    let ws = Arc::new(ws);
                    ws.supervise();
                    app.manage(Arc::clone(&ws));
                }

                // 阻塞等待后端就绪后再建窗口，确保窗口加载时后端已在监听，避免出现空白/错误页
                if !wait_for_backend(port) {
                    eprintln!("[lectoforge] 后端健康检查未通过，端口 {port} 上没有响应预期的服务");
                }

                api_port = port;

                apply_shell_style(WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::External(format!("http://127.0.0.1:{port}").parse().unwrap()),
                ))
                .title("LectoForge 学习工作台")
                .build()?;
            }

            #[cfg(debug_assertions)]
            {
                apply_shell_style(WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::External("http://localhost:5173".parse().unwrap()),
                ))
                .title("LectoForge 学习工作台 (dev)")
                .build()?;
            }

            // 无边框窗口原生阴影：对 "main" 窗口调用 NSWindow 原生 setHasShadow，
            // 恢复 decorations:false 后被系统停掉的层次感。仅 macOS / Windows 生效；
            // Linux 下该函数为空实现（crate 内部按 target_os 分流），调用安全无副作用。
            // （apply_shell_style 已设 .shadow(true)，这里再强制一次，覆盖透明窗口的边界情况。）
            window_shadows_v2::set_shadows(app, true);

            // 2) 共享状态
            let reminder_enabled = Arc::new(Mutex::new(true));
            app.manage(AppState { reminder_enabled: reminder_enabled.clone() });

            // 3) 原生菜单（macOS 首个子菜单即 App 菜单）
            let about = PredefinedMenuItem::about(app, Some("关于 LectoForge 学习工作台"), None)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let check_update = MenuItemBuilder::with_id("check_update", "检查更新…").build(app)?;
            let go_review = MenuItemBuilder::with_id("go_review", "去学习复习").build(app)?;
            let toggle_reminder = MenuItemBuilder::with_id("toggle_reminder", "复习提醒：开").build(app)?;
            // 番茄钟常驻菜单项：id 固定为 timer_menu（前端 emit 的 pomodoro:update 事件据此 set_text 刷新文案）。
            // 初始文案为待机态，运行/暂停时由前端实时推「🍅 专注中 12:34」这类倒计时。
            let timer_status = MenuItemBuilder::with_id("timer_menu", "🍅 番茄钟 待机").build(app)?;
            let reload = MenuItemBuilder::with_id("reload", "重新加载页面").build(app)?;

            let app_menu = SubmenuBuilder::new(app, "LectoForge")
                .item(&about)
                .separator()
                .item(&check_update)
                .item(&go_review)
                .item(&toggle_reminder)
                .separator()
                .item(&timer_status)
                .item(&quit)
                .build()?;

            // macOS 的 WKWebView 依赖原生「编辑」菜单里的 copy:/paste:/cut:/selectAll:
            // 等 selector 接入响应链，键盘复制粘贴（⌘C/⌘V 或 Windows/Linux 的 Ctrl+C/V）
            // 才会生效。缺了它，输入框里的 Ctrl+C/V 会静默失效，这是 Tauri 2 的已知坑。
            let edit_menu = SubmenuBuilder::new(app, "编辑")
                .item(&PredefinedMenuItem::undo(app, Some("撤销"))?)
                .item(&PredefinedMenuItem::redo(app, Some("重做"))?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, Some("剪切"))?)
                .item(&PredefinedMenuItem::copy(app, Some("复制"))?)
                .item(&PredefinedMenuItem::paste(app, Some("粘贴"))?)
                .separator()
                .item(&PredefinedMenuItem::select_all(app, Some("全选"))?)
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "视图")
                .item(&reload)
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &view_menu])
                .build()?;
            app.set_menu(menu)?;

            // 4) 菜单事件处理
            let reminder_enabled_ev = reminder_enabled.clone();
            let toggle_item = toggle_reminder.clone();
            app.on_menu_event(move |app, event| match event.id().as_ref() {
                "quit" => app.exit(0),
                "check_update" => {
                    let h = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = do_check_update(h).await;
                    });
                }
                "go_review" => {
                    focus_main_window(app);
                    let _ = app.emit("navigate", "/reviews");
                }
                "toggle_reminder" => {
                    let mut en = reminder_enabled_ev.lock().unwrap();
                    *en = !*en;
                    let label = if *en { "复习提醒：开" } else { "复习提醒：关" };
                    let _ = toggle_item.set_text(label);
                }
                "timer_menu" => {
                    // 点「番茄钟」菜单项 → 激活主工作台并跳到番茄钟页（不再有独立弹窗）
                    focus_main_window(app);
                    let _ = app.emit("navigate", "/pomodoro");
                }
                "reload" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.eval("location.reload()");
                    }
                }
                _ => {}
            });

            // 番茄钟常驻倒计时：前端每次秒级 tick 都 emit tray:update（payload.title），
            // 这里把标题刷到 App 菜单「番茄钟」项文案上（与托盘标题同源）。
            let timer_item = timer_status.clone();
            app.listen("tray:update", move |event| {
                let payload: serde_json::Value =
                    serde_json::from_str(event.payload()).unwrap_or(serde_json::Value::Null);
                let title = payload
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let text = if title.is_empty() {
                    "🍅 番茄钟 待机".to_string()
                } else {
                    title.to_string()
                };
                let _ = timer_item.set_text(&text);
            });

            // 菜单栏番茄钟（状态栏常驻图标 + 实时倒计时 + 快捷菜单 + 原生通知）
            tray::create_tray(app.handle())?;

            // 关闭主窗口时不退出应用，仅隐藏——配合托盘实现「后台运行，无需主窗口」
            let app_for_close = app.handle().clone();
            if let Some(win) = app.get_webview_window("main") {
                win.on_window_event(move |e| {
                    if let WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        if let Some(w) = app_for_close.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }

            // 主工作台是一等公民：启动即可见（不再像纯菜单栏形态那样 hide），
            // 番茄钟胶囊内嵌在顶栏里，托盘只作为倒计时指示器（点击回到本窗口）。

            // 5) 后台复习提醒调度（每 30 分钟轮询后端，有待复习卡片则弹原生通知）
            start_reminder_scheduler(app.handle().clone(), reminder_enabled.clone(), api_port);

            // 6) 数据自动备份调度（每日循环，到点触发后端备份；计划变更即时生效）
            // 先把真实端口写进全局原子量，备份类命令（无 setup 上下文）才能拿到正确端口
            API_PORT.store(api_port, std::sync::atomic::Ordering::Relaxed);
            start_backup_scheduler(app.handle().clone(), api_port);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![check_for_update, restart_sidecar, select_directory, capture_screenshot, trigger_notification, open_external_url, quit_app, update_tray_title, take_pending_deep_link, create_backup, set_backup_schedule, get_backup_schedule, open_backup_folder, list_backups])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // 浏览器扩展 / 外部以 lectoforge://capture?url=&title=&text= 拉起应用时，
            // 解析深链并通知前端唤起全局速记弹窗、预填剪藏内容。
            // 无需引入深链插件依赖：CFBundleURLTypes 已在 src-tauri/Info.plist 注册，
            // 由系统把 lectoforge:// 路由到本应用，Tauri 2 以 RunEvent::Opened 暴露 URL。
            if let tauri::RunEvent::Opened { urls } = &event {
                for u in urls {
                    if u.scheme() == "lectoforge" {
                        // 把查询参数收成 owned 的 (key,value) 列表，便于按 key 取用
                        let pairs: Vec<(String, String)> = u.query_pairs().into_owned().collect();
                        let get = |k: &str| {
                            pairs
                                .iter()
                                .find(|(key, _)| key == k)
                                .map(|(_, v)| v.clone())
                                .unwrap_or_default()
                        };
                        let payload = serde_json::json!({
                            "action": u.path().trim_start_matches('/'),
                            "title": get("title"),
                            "content": get("text"),
                            "sourceUrl": get("url"),
                        });
                        // 双保险：① 实时 emit 给已监听的前端；② 写入缓冲供冷启动兜底取用
                        if let Ok(mut g) = app_handle.state::<DeepLinkState>().pending.lock() {
                            *g = Some(payload.clone());
                        }
                        let _ = app_handle.emit("deep-link", payload);
                    }
                }
            }

            // 退出时回收 Node 侧车，避免它变成孤儿进程继续占着端口
            #[cfg(not(debug_assertions))]
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(mgr) = app_handle.try_state::<Arc<SidecarManager>>() {
                    mgr.shutdown();
                }
                if let Some(mgr) = app_handle.try_state::<Arc<WhisperSidecar>>() {
                    mgr.shutdown();
                }
            }
        });
}

/// 释放被上一次没退干净的侧车占住的端口（仅 macOS/Linux 用 lsof 查监听进程并 SIGKILL）。
/// 目的：保证窗口始终连到 8787（与 capability 的 remote 可信来源一致），
/// 避免端口漂移导致 Tauri IPC/ACL 因 origin 不匹配而拒绝自定义命令。
/// 8787 是本应用专用端口，杀掉它的只可能是我们自己的残留侧车，风险可控。
#[cfg(not(debug_assertions))]
fn free_port(port: u16) {
    #[cfg(unix)]
    {
        let out = Command::new("/usr/sbin/lsof")
            .args(["-ti", &format!("tcp:{port}")])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
        if let Ok(o) = out {
            let pids = String::from_utf8_lossy(&o.stdout);
            for pid in pids.split_whitespace() {
                if let Ok(p) = pid.parse::<u32>() {
                    signal_process(p, true);
                }
            }
        }
    }
}

/// 从 preferred 开始找一个当前可绑定的回环端口。
/// 绑定成功即刻释放，把这个端口交给侧车去正式监听；中间的竞态窗口只有毫秒级，
/// 换来的是宿主与后端对端口达成一致，不会再出现「窗口连到别人的服务」。
#[cfg(not(debug_assertions))]
fn pick_free_port(preferred: u16) -> u16 {
    // 只在 preferred..preferred+19 内找。范围刻意收窄：capability 的 remote.urls
    // 写死 8787，真漂到别的端口 ACL 就会失效（详见 SidecarManager::supervise 文档），
    // 所以这里的循环是「兜底不崩」，正常路径应当第一轮就命中 preferred。
    for offset in 0..20u16 {
        let port = preferred.saturating_add(offset);
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    preferred
}

/// 轮询后端健康检查端点，最多等待约 15 秒。
/// 只探测 TCP 连通性是不够的——端口上可能坐着别的程序；这里校验响应里的服务标识，
/// 确认它确实是我们刚拉起的那个后端。
#[cfg(not(debug_assertions))]
fn wait_for_backend(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/health");
    for _ in 0..75 {
        if let Ok(resp) = ureq::get(&url).timeout(Duration::from_millis(800)).call() {
            if let Ok(v) = resp.into_json::<serde_json::Value>() {
                // 后端统一信封 {code, data}，兼容裸响应
                let svc = v
                    .pointer("/data/service")
                    .or_else(|| v.get("service"))
                    .and_then(|x| x.as_str());
                if svc == Some("lectoforge-desktop-api") {
                    return true;
                }
            }
        }
        sleep(Duration::from_millis(200));
    }
    false
}

/// 后台线程：周期性检查待复习卡片，必要时弹原生通知
fn start_reminder_scheduler(app: tauri::AppHandle, enabled: Arc<Mutex<bool>>, port: u16) {
    std::thread::spawn(move || loop {
        sleep(Duration::from_secs(30 * 60));
        if !*enabled.lock().unwrap() {
            continue;
        }
        if let Some((count, sample)) = fetch_due_count(port) {
            if count > 0 {
                show_review_notification(&app, count, &sample);
            }
        }
    });
}

/// 调用后端 /api/workbench/reviews/due-count
fn fetch_due_count(port: u16) -> Option<(u32, Vec<String>)> {
    let url = format!("http://127.0.0.1:{port}/api/workbench/reviews/due-count");
    let resp = ureq::get(&url)
        .timeout(Duration::from_secs(3))
        .call()
        .ok()?;
    let v: serde_json::Value = resp.into_json().ok()?;
    // 后端统一信封 {code, data}，计数在 data 内
    let data = v.get("data")?;
    let count = data.get("count")?.as_u64()? as u32;
    let sample: Vec<String> = data
        .get("sample")?
        .as_array()?
        .iter()
        .filter_map(|x| x.as_str().map(|s| s.to_string()))
        .collect();
    Some((count, sample))
}

/// 弹出复习提醒通知。
/// 注：tauri-plugin-notification 2.3.x 桌面端 builder 不提供 on_click 回调，
/// 点击通知会由系统原生聚焦应用到前台；跳转到复习页可走菜单「去学习复习」或侧边栏导航。
fn show_review_notification(app: &tauri::AppHandle, count: u32, sample: &[String]) {
    let app = app.clone();
    let mut body = format!("你有 {} 张卡片待复习", count);
    if !sample.is_empty() {
        body.push_str("：");
        body.push_str(&sample.join("、"));
    }
    let _ = app
        .notification()
        .builder()
        .title("LectoForge 复习提醒")
        .body(body)
        .show();
}

/// 检查并安装更新（菜单「检查更新」与前端命令共用）
async fn do_check_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            let newv = update.version.to_string();
            update
                .download_and_install(
                    |_downloaded: usize, _total: Option<u64>| {},
                    || {},
                )
                .await
                .map_err(|e| e.to_string())?;
            let _ = app
                .notification()
                .builder()
                .title("更新已安装")
                .body(format!("已升级到版本 {}", newv))
                .show();
            Ok(json!({ "update": true, "to": newv }))
        }
        Ok(None) => {
            let _ = app
                .notification()
                .builder()
                .title("已是最新")
                .body("当前已是最新版本")
                .show();
            Ok(json!({ "update": false }))
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 供前端调用的「检查更新」命令（侧边栏按钮使用）
#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    do_check_update(app).await
}

/// 供前端调用的「手动重启知识引擎」命令。
/// 前端重连遮罩里点「立即重启引擎」时走这里：杀掉当前侧车，
/// 监控线程 wait() 返回后会按既有策略自动拉起新实例。
#[tauri::command]
fn restart_sidecar(_app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(not(debug_assertions))]
    {
        let mgr = _app
            .try_state::<Arc<SidecarManager>>()
            .ok_or_else(|| "侧车管理器未初始化".to_string())?;
        let pid = *mgr.pid.lock().map_err(|e| e.to_string())?;
        match pid {
            Some(p) => {
                signal_process(p, false);
                Ok(json!({ "restarting": true, "killedPid": p }))
            }
            // 进程本就不在，监控线程正处于退避等待，稍后会自行拉起
            None => Ok(json!({ "restarting": true, "killedPid": null })),
        }
    }
    #[cfg(debug_assertions)]
    {
        Ok(json!({ "restarting": false, "reason": "开发模式下后端由 npm run dev:api 托管" }))
    }
}

/// 供前端调用的「选择文件夹」命令（引导页 / 设置中心的数据目录选择使用）。
///
/// 用 tauri-plugin-dialog 打开系统原生的目录选择弹窗，返回选中目录的绝对路径；
/// 用户取消选择时返回 Err，前端据此静默处理（不视为错误提示）。
///
/// 实现说明：命令声明为 async，Tauri 会在其异步运行时线程池上执行（非 UI 主线程），
/// 因此这里用 blocking_pick_folder 阻塞等待用户结果是安全的，弹窗仍由插件在主线程正确弹出。
#[tauri::command]
async fn select_directory(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    match app.dialog().file().blocking_pick_folder() {
        Some(folder) => Ok(folder.to_string()),
        None => Err("用户取消了选择".to_string()),
    }
}

/// 供前端调用的「截图」命令：实现离线 OCR 的「截图识别」来源。
///
/// 调用 macOS 内置的 /usr/sbin/screencapture 进行交互式矩形框选（用户拖拽选区域），
/// 截图写入临时 PNG，读取后 base64 回传给前端，走 tesseract.js 离线识别。
///
/// 注意：
/// - 截图前先 hide 主窗口，避免透明窗口被框选进来；完成后 show + unminimize + set_focus 还原。
/// - 用户按 ESC 取消时 screencapture 以非 0 退出且不生成文件 → 返回 Err("cancelled")，
///   前端据此静默回到来源选择，不当作错误提示。
/// - 首次使用需 macOS「屏幕录制」授权；未授权时命令失败，错误信息会提示去系统设置开启。
#[tauri::command]
fn capture_screenshot(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Err("截图功能仅支持 macOS".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        // 截图期间隐藏主窗口，避免被框选进来
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }

        let tmp =
            std::env::temp_dir().join(format!("lectoforge_shot_{}.png", std::process::id()));
        let tmp_str = tmp.to_str().unwrap_or("/tmp/lectoforge_shot.png");

        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-i", "-r", tmp_str])
            .status();

        // 无论成功或取消都先还原窗口
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }

        match status {
            Ok(s) if s.success() => {}
            _ => return Err("cancelled".to_string()),
        }

        let bytes = std::fs::read(&tmp)
            .map_err(|_| "截图未生成，可能已取消或无权访问屏幕（请检查「屏幕录制」授权）".to_string())?;
        let _ = std::fs::remove_file(&tmp);
        Ok(encode_base64(&bytes))
    }
}

/// 极简 base64 编码（标准字母表 + '=' 填充），仅用于把截图 PNG 回传前端，
/// 避免为这一处需求引入额外的 cargo 依赖。
fn encode_base64(data: &[u8]) -> String {
    const CHARS: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    let mut i = 0;
    while i + 2 < data.len() {
        let n = (u32::from(data[i]) << 16) | (u32::from(data[i + 1]) << 8) | u32::from(data[i + 2]);
        out.push(CHARS[((n >> 18) & 63) as usize] as char);
        out.push(CHARS[((n >> 12) & 63) as usize] as char);
        out.push(CHARS[((n >> 6) & 63) as usize] as char);
        out.push(CHARS[(n & 63) as usize] as char);
        i += 3;
    }
    let rem = data.len() - i;
    if rem == 1 {
        let n = u32::from(data[i]) << 16;
        out.push(CHARS[((n >> 18) & 63) as usize] as char);
        out.push(CHARS[((n >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let n = (u32::from(data[i]) << 16) | (u32::from(data[i + 1]) << 8);
        out.push(CHARS[((n >> 18) & 63) as usize] as char);
        out.push(CHARS[((n >> 12) & 63) as usize] as char);
        out.push(CHARS[((n >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

/// 供前端调用的「原生通知」命令：计时阶段结束时由番茄钟 store 直接 invoke 触发
/// macOS Notification Center 提醒（即便所有窗口都隐藏，系统通知照常弹出）。
#[tauri::command]
fn trigger_notification(app: tauri::AppHandle, title: String, body: String) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.notification().builder().title(title).body(body).show();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, title, body);
    }
}

/// 激活并前置主工作台窗口（唯一入口，托盘左键 / 原生菜单项共用）。
///
/// 三步缺一不可：
/// - `show()`：主窗口可能被「关闭即隐藏」策略藏起来了（见 CloseRequested 处理）；
/// - `unminimize()`：最小化到 Dock 的窗口 `set_focus` 不会自己还原；
/// - `set_focus()`：把应用切到前台（macOS 下等价于 activate）。
pub(crate) fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 供前端调用的「打开外部链接」命令：设置/关于页的外链走这里直接交给系统默认浏览器处理，
/// 不引入 tauri-plugin-shell 的 `open` 全局
/// （避免给前端多开一个权限口子；URL 是否合法由调用方负责）。
#[tauri::command]
fn open_external_url(url: String) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    }
}

/// 供前端调用的「退出应用」命令：设置页 / 托盘右键菜单的「退出」走这里。
/// 用 `app.exit(0)` 走正常的 Tauri 退出流程（回收 Node 侧车、关闭 webview），
/// 不要用 std::process::exit，那样会跳过侧车清理留下孤儿进程。
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// =============================================================================
// 数据自动备份（设置中心「数据备份」区 + Rust 每日调度器共用）
//
// 架构：Rust 不直接打包文件，而是作为「调度与编排」层——
//   - 立即备份 / 每日调度都通过 ureq 调后端 POST /api/backup 触发（后端在 Node 侧车里
//     用 child_process 拉起 backup.js，依赖 archiver 完成真正的 zip 打包）；
//   - 计划（enabled / time / outDir）由后端持久化到 <dataDir>/backup-config.json，
//     Rust 侧仅做中转与读取；
//   - 调度器用 tauri::async_runtime::spawn 长驻循环，到点重新拉取最新计划再触发（改设置即时生效）。
// 这样路径解析（getDbPath / getUploadsDir）与 zip 逻辑都在 Node 侧，dev/build 都稳。
// =============================================================================

#[derive(Clone, Default)]
struct BackupSchedule {
    enabled: bool,
    time: String,
    out_dir: String,
}

/// 调后端 POST /api/backup 触发一次备份（阻塞调用，须配合 spawn_blocking）。
fn post_backup_sync(port: u16, out_dir: &str) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{port}/api/backup");
    let body = serde_json::json!({ "outDir": out_dir });
    let resp = ureq::post(&url)
        .timeout(std::time::Duration::from_secs(300))
        .send_json(body)
        .map_err(|e| format!("触发备份失败：{e}"))?;
    let v: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("备份响应解析失败：{e}"))?;
    let zip = v
        .pointer("/data/zipPath")
        .and_then(|p| p.as_str())
        .ok_or_else(|| "备份未返回 zip 路径".to_string())?;
    Ok(zip.to_string())
}

/// 读取后端备份计划（阻塞调用）。
fn get_backup_schedule_sync(port: u16) -> Option<BackupSchedule> {
    let url = format!("http://127.0.0.1:{port}/api/backup/schedule");
    let resp = ureq::get(&url).timeout(std::time::Duration::from_secs(5)).call().ok()?;
    let v: serde_json::Value = resp.into_json().ok()?;
    let d = v.get("data")?;
    Some(BackupSchedule {
        enabled: d.get("enabled").and_then(|x| x.as_bool()).unwrap_or(false),
        time: d
            .get("time")
            .and_then(|x| x.as_str())
            .unwrap_or("03:00")
            .to_string(),
        out_dir: d
            .get("outDir")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// 前端「立即备份」命令：经后端 child_process 跑 backup.js，返回 zip 绝对路径。
#[tauri::command]
async fn create_backup(out_dir: String) -> Result<String, String> {
    let port = API_PORT.load(std::sync::atomic::Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || post_backup_sync(port, &out_dir))
        .await
        .map_err(|e| e.to_string())?
}

/// 前端保存备份计划命令：转发到后端持久化（enabled / time / outDir）。
#[tauri::command]
async fn set_backup_schedule(enabled: bool, time: String, out_dir: String) -> Result<(), String> {
    let port = API_PORT.load(std::sync::atomic::Ordering::Relaxed);
    let url = format!("http://127.0.0.1:{port}/api/backup/schedule");
    let body = serde_json::json!({ "enabled": enabled, "time": time, "outDir": out_dir });
    tauri::async_runtime::spawn_blocking(move || {
        ureq::put(&url)
            .timeout(std::time::Duration::from_secs(5))
            .send_json(body)
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(())
}

/// 前端读取备份计划命令：供设置页初始化「每日自动备份」开关与时刻。
#[tauri::command]
async fn get_backup_schedule() -> Result<serde_json::Value, String> {
    let port = API_PORT.load(std::sync::atomic::Ordering::Relaxed);
    let s = tauri::async_runtime::spawn_blocking(move || get_backup_schedule_sync(port))
        .await
        .map_err(|e| e.to_string())?;
    match s {
        Some(s) => Ok(serde_json::json!({ "enabled": s.enabled, "time": s.time, "outDir": s.out_dir })),
        None => Ok(serde_json::json!({ "enabled": false, "time": "03:00", "outDir": "" })),
    }
}

/// 列出某目录下的备份 zip 文件（名称 / 字节大小 / 修改时间，倒序），供设置页展示最近备份。
#[tauri::command]
fn list_backups(dir: String) -> Result<Vec<serde_json::Value>, String> {
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("无法读取备份目录：{e}"))?;
    let mut out = Vec::new();
    for e in entries.filter_map(|x| x.ok()) {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) == Some("zip") {
            if let Ok(meta) = p.metadata() {
                if meta.is_file() {
                    let modified_at = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    out.push(serde_json::json!({
                        "name": p.file_name().and_then(|x| x.to_str()).unwrap_or(""),
                        "size": meta.len(),
                        "modifiedAt": modified_at,
                    }));
                }
            }
        }
    }
    out.sort_by(|a, b| b["modifiedAt"].as_u64().cmp(&a["modifiedAt"].as_u64()));
    Ok(out)
}

/// 打开备份目录（在访达/Finder 中定位）：用 shell 插件唤起系统 `open`，
/// 失败时兜底 std::process::Command（与 open_external_url 同款写法，仓库刻意禁用 shell.open 全局）。
#[tauri::command]
async fn open_backup_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_shell::ShellExt;
        if app.shell().command("open").args([path.clone()]).spawn().is_ok() {
            return Ok(());
        }
        let _ = std::process::Command::new("open").arg(&path).spawn();
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&path).spawn();
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
        Ok(())
    }
}

/// 计算到下一个 `HH:MM`（本地时区）的等待时长；已过的时刻顺延到明天。
fn duration_until(time: &str) -> Option<std::time::Duration> {
    // from_local_datetime 是 TimeZone trait 的方法，必须把 trait 引进作用域才能调用
    use chrono::TimeZone;
    let mut it = time.split(':');
    let h: u32 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    let now = chrono::Local::now();
    let date = now.date_naive();
    let target_naive = date.and_hms_opt(h, m, 0)?;
    // 夏令时切换当天某些本地时刻可能不存在/二义，取不到就顺延到明天同一时刻
    let mut target = match chrono::Local.from_local_datetime(&target_naive).single() {
        Some(t) => t,
        None => chrono::Local
            .from_local_datetime(&date.succ_opt()?.and_hms_opt(h, m, 0)?)
            .single()?,
    };
    if target <= now {
        target += chrono::Duration::days(1);
    }
    let secs = (target - now).num_seconds().max(0) as u64;
    Some(std::time::Duration::from_secs(secs))
}

/// 每日备份调度器：在 Tauri 异步运行时里长驻循环，到点触发后端备份。
/// 用 tauri::async_runtime::spawn 跑（用户明确要求），配合 tokio::time::sleep 不阻塞运行时。
/// 每次循环都重新拉取最新计划，使「设置中心改时间/开关」即时生效，无需重启。
fn start_backup_scheduler(app: tauri::AppHandle, port: u16) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let sched = match tauri::async_runtime::spawn_blocking(move || get_backup_schedule_sync(port))
                .await
                .ok()
                .flatten()
            {
                Some(s) if s.enabled && !s.out_dir.is_empty() => s,
                _ => continue,
            };
            let wait = match duration_until(&sched.time) {
                Some(d) => d,
                None => {
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    continue;
                }
            };
            tokio::time::sleep(wait).await;
            // 到点再确认一次（用户可能中途关掉了自动备份）
            if let Some(s) =
                tauri::async_runtime::spawn_blocking(move || get_backup_schedule_sync(port)).await.ok().flatten()
            {
                if s.enabled && !s.out_dir.is_empty() {
                    let done =
                        tauri::async_runtime::spawn_blocking(move || post_backup_sync(port, &s.out_dir)).await;
                    // 让用户「看得见」自动备份确实跑过了——这正是本能力要给的安全感
                    match done {
                        Ok(Ok(zip)) => {
                            let _ = app.emit("backup:done", &zip);
                            #[cfg(target_os = "macos")]
                            {
                                let _ = app
                                    .notification()
                                    .builder()
                                    .title("LectoForge 自动备份完成")
                                    .body(&zip)
                                    .show();
                            }
                        }
                        Ok(Err(e)) => {
                            let _ = app.emit("backup:failed", &e);
                        }
                        Err(_) => {}
                    }
                }
            }
        }
    });
}

/// 取出并清空一条待消费的深链剪藏（lectoforge://capture 拉起时由 `RunEvent::Opened` 写入）。
///
/// 用途：冷启动场景下，应用被 URL Scheme 拉起时前端 `listen("deep-link")` 可能尚未注册，
/// 直接 `emit` 会丢事件。前端 `onMounted` 注册监听后调用此命令取一次缓冲作为兜底，
/// 与 `emit` 事件双保险，确保浏览器剪藏内容一定能抵达速记弹窗。
#[tauri::command]
fn take_pending_deep_link(state: tauri::State<DeepLinkState>) -> Option<serde_json::Value> {
    state.pending.lock().ok().and_then(|mut g| g.take())
}

/// 菜单栏标题刷新命令：番茄钟 store 每秒把当前倒计时（如「🍅 24:59」）通过此命令推给 Rust，
/// 由 Rust 把「阶段色圆点 + MM:SS」烤进托盘图标位图并 `set_icon`，实现逐秒倒计时。
///
/// 为什么画进图标而不是用 `set_title`：Tauri 2 在部分 macOS 版本上，托盘初始标题能显示、
/// 但运行时反复 `set_title` 不一定触发状态栏重绘（已知坑，正是此前「菜单栏永远停在 🍅 25:00」
/// 的根因）。而「更换图标」(`set_icon`) 在 macOS 上必然触发 NSStatusItem 重绘，是最可靠的通道。
/// 命令通道由 `invoke` 直接调用 Rust 函数，无事件路由歧义、必然触达；
/// 事件通道（tray.rs 的 `tray:update` 监听）仍作兜底，二者都走同一套图标渲染逻辑。
#[tauri::command]
fn update_tray_title(app: tauri::AppHandle, title: String) {
    // 落盘诊断：确认前端 invoke 是否真正到达 Rust（build 模式无终端，写 /tmp 便于 cat 排查）
    crate::tray::append_pomodoro_log(&format!(
        "[pomodoro] INVOKE update_tray_title -> {title}"
    ));
    // 渲染逻辑与 tray id 收敛在 tray.rs 的 paint_tray_title，避免两处不一致
    crate::tray::paint_tray_title(&app, &title);
}
