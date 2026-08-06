#[cfg(not(debug_assertions))]
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::Duration;

use tauri::Emitter;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, PredefinedMenuItem};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;
use serde_json::json;

const DEFAULT_BACKEND_PORT: u16 = 8787;

/// 共享状态：复习提醒开关（菜单可切换，后台调度线程读取）
struct AppState {
    // 由 manage 托管供后续 Tauri 命令读取，调度线程另持有同一个 Arc
    #[allow(dead_code)]
    reminder_enabled: Arc<Mutex<bool>>,
}

/// 持有 Node 侧车句柄，供退出时回收。
/// 不回收的话侧车会变成孤儿进程常驻后台：端口一直被占，下次启动只能往后漂，
/// 反复开关几次就会堆积出一串各占上百 MB 的僵尸后端。
#[cfg(not(debug_assertions))]
struct SidecarGuard(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // 后端实际监听端口：生产由宿主协商后写入，开发固定用默认值（dev:api 监听它）
            #[allow(unused_mut, unused_assignments)]
            let mut api_port: u16 = DEFAULT_BACKEND_PORT;

            // 1) 打开主窗口（生产起 Node 侧车，开发加载 vite）
            #[cfg(not(debug_assertions))]
            {
                let resolver = app.path();
                let resource_dir = resolver.resource_dir()?;
                let web_dir = resource_dir.join("web");
                let api_dir = resource_dir.join("api");
                let api_index = api_dir.join("index.js");
                let data_dir = resolver.app_data_dir()?;
                std::fs::create_dir_all(&data_dir)?;

                /* 端口必须由宿主先协商好再传给侧车。
                 * 后端在 EADDRINUSE 时会自行 +1 漂移，若这里仍写死 8787，
                 * 一旦上一次的实例没退干净，窗口就会连到那个陈旧服务上（它托管的是
                 * 已被替换掉的旧构建产物），页面会卡在加载态。 */
                let port = pick_free_port(DEFAULT_BACKEND_PORT);

                let sidecar = app
                    .shell()
                    .sidecar("server")
                    .expect("未找到 Node 侧车，请先运行 scripts/prepare-bin.sh")
                    .args([
                        api_index.to_str().unwrap(),
                        "--port",
                        &port.to_string(),
                        "--web-dir",
                        web_dir.to_str().unwrap(),
                        "--data-dir",
                        data_dir.to_str().unwrap(),
                    ]);
                let (mut rx, child) = sidecar.spawn().expect("启动后端侧车失败");
                // 持续消费事件流，既避免通道积压，也把后端日志透出便于排查
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_shell::process::CommandEvent;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                print!("[knowflow-api] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Stderr(line) => {
                                eprint!("[knowflow-api] {}", String::from_utf8_lossy(&line));
                            }
                            _ => {}
                        }
                    }
                });
                app.manage(SidecarGuard(Mutex::new(Some(child))));

                // 阻塞等待后端就绪后再建窗口，确保窗口加载时后端已在监听，避免出现空白/错误页
                if !wait_for_backend(port) {
                    eprintln!("[knowflow] 后端健康检查未通过，端口 {port} 上没有响应预期的服务");
                }

                api_port = port;

                WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::External(format!("http://127.0.0.1:{port}").parse().unwrap()),
                )
                .title("KnowFlow 学习工作台")
                .inner_size(1200.0, 800.0)
                .build()?;
            }

            #[cfg(debug_assertions)]
            {
                WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::External("http://localhost:5173".parse().unwrap()),
                )
                .title("KnowFlow 学习工作台 (dev)")
                .inner_size(1200.0, 800.0)
                .build()?;
            }

            // 2) 共享状态
            let reminder_enabled = Arc::new(Mutex::new(true));
            app.manage(AppState { reminder_enabled: reminder_enabled.clone() });

            // 3) 原生菜单（macOS 首个子菜单即 App 菜单）
            let about = PredefinedMenuItem::about(app, Some("关于 KnowFlow 学习工作台"), None)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let check_update = MenuItemBuilder::with_id("check_update", "检查更新…").build(app)?;
            let go_review = MenuItemBuilder::with_id("go_review", "去学习复习").build(app)?;
            let toggle_reminder = MenuItemBuilder::with_id("toggle_reminder", "复习提醒：开").build(app)?;
            let reload = MenuItemBuilder::with_id("reload", "重新加载页面").build(app)?;

            let app_menu = SubmenuBuilder::new(app, "KnowFlow")
                .item(&about)
                .separator()
                .item(&check_update)
                .item(&go_review)
                .item(&toggle_reminder)
                .separator()
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
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = app.emit("navigate", "/reviews");
                }
                "toggle_reminder" => {
                    let mut en = reminder_enabled_ev.lock().unwrap();
                    *en = !*en;
                    let label = if *en { "复习提醒：开" } else { "复习提醒：关" };
                    let _ = toggle_item.set_text(label);
                }
                "reload" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.eval("location.reload()");
                    }
                }
                _ => {}
            });

            // 5) 后台复习提醒调度（每 30 分钟轮询后端，有待复习卡片则弹原生通知）
            start_reminder_scheduler(app.handle().clone(), reminder_enabled.clone(), api_port);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![check_for_update])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, _event| {
            // 退出时回收 Node 侧车，避免它变成孤儿进程继续占着端口
            #[cfg(not(debug_assertions))]
            if matches!(_event, tauri::RunEvent::Exit) {
                if let Some(guard) = _app_handle.try_state::<SidecarGuard>() {
                    if let Ok(mut slot) = guard.0.lock() {
                        if let Some(child) = slot.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}

/// 从 preferred 开始找一个当前可绑定的回环端口。
/// 绑定成功即刻释放，把这个端口交给侧车去正式监听；中间的竞态窗口只有毫秒级，
/// 换来的是宿主与后端对端口达成一致，不会再出现「窗口连到别人的服务」。
#[cfg(not(debug_assertions))]
fn pick_free_port(preferred: u16) -> u16 {
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
                if svc == Some("knowflow-desktop-api") {
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
        .title("KnowFlow 复习提醒")
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
