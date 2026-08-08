// src-tauri/src/tray.rs
//
// macOS 菜单栏（状态栏）番茄钟指示器 —— 2026-08-08 形态回归后的定位：
//
// 托盘只是一个**只读状态指示器**，不再承载任何番茄钟交互：
// - 状态栏常驻「阶段色圆点 + MM:SS」图标，每秒由前端 invoke `update_tray_title`
//   命令（emit `tray:update` 事件兜底）刷新；
// - 左键点击：激活并前置主工作台窗口（真正的控制台是顶栏里的 TimerCapsule 胶囊），
//   此前的「展开/收起毛玻璃弹窗（pomodoro_popup）」逻辑已随弹窗一并删除；
// - 右键点击：弹出原生菜单（显示主窗口 / 退出）；
// - 计时结束的原生通知由前端直接 invoke `trigger_notification` 命令，不经过此模块。
//
// 计时逻辑完全在渲染进程（pomodoroStore，主窗口内）里跑——主窗口即便被隐藏到托盘，
// 隐藏的 WebView 仍在执行 JS，时间戳差值法保证后台节流/休眠也不掉秒，图标照常刷新。

use tauri::{
    image::Image,
    menu::{IsMenuItem, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Listener,
};
use tauri::AppHandle;

/// 番茄钟诊断落盘：build 模式下 Rust 进程的 stdout/stderr 用户看不到，
/// 写到 /tmp/lectoforge_pomodoro.log 便于真机 `cat` 排查菜单栏刷新链路。
pub(crate) fn append_pomodoro_log(line: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/lectoforge_pomodoro.log")
    {
        let _ = writeln!(f, "{line}");
    }
}

/// 菜单栏番茄钟倒计时渲染：把「阶段色圆点 + MM:SS」烤进托盘图标位图。
///
/// 为什么不用 set_title：Tauri 2 在部分 macOS 版本上，托盘初始标题能显示，
/// 但运行时反复 set_title 不一定触发状态栏重绘（已知坑），导致标题卡在初值不动。
/// 而「更换图标」(set_icon) 在 macOS 上一定会触发 NSStatusItem 重绘，
/// 因此把倒计时文字画进图标，是最可靠的逐秒刷新方案。
/// 文本用「白字 + 1px 暗描边」，在浅色/深色菜单栏上都可读。
const TRAY_FONT: &[(char, [u8; 7])] = &[
    ('0', [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110]),
    ('1', [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110]),
    ('2', [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111]),
    ('3', [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110]),
    ('4', [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010]),
    ('5', [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110]),
    ('6', [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110]),
    ('7', [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000]),
    ('8', [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110]),
    ('9', [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100]),
    (':', [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000]),
];

/// 在 RGBA 缓冲上画一个不透明像素（越界忽略）。
fn tray_set_px(buf: &mut [u8], w: u32, h: u32, x: i32, y: i32, c: (u8, u8, u8)) {
    if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
        return;
    }
    let idx = ((y as u32) * w + (x as u32)) as usize * 4;
    buf[idx] = c.0;
    buf[idx + 1] = c.1;
    buf[idx + 2] = c.2;
    buf[idx + 3] = 255;
}

/// 把「阶段色圆点 + MM:SS」渲染成一张透明背景的托盘图标位图（自带 2x 视网膜）。
fn render_time_icon(text: &str, dot: (u8, u8, u8)) -> Image<'_> {
    let s: u32 = 2; // 2x 视网膜
    let gw: u32 = 5;
    let gh: u32 = 7;
    let gap: u32 = 1;
    let chars: Vec<char> = text.chars().collect();
    let text_w = chars.len() as u32 * (gw + gap);
    let dot_d: u32 = 9; // 圆点直径（基准 px）
    let pad: u32 = 2;
    let w = (pad + dot_d + 3 + text_w + pad) * s;
    let h = (gh + 4) * s;
    let mut buf = vec![0u8; (w * h * 4) as usize];

    let txt_color = (242, 242, 247);
    let outline = (28, 28, 30);

    // 阶段圆点（垂直居中）
    let cx = (pad + dot_d / 2) as i32 * s as i32;
    let cy = (h / 2) as i32;
    let r = (dot_d / 2) as i32 * s as i32;
    for yy in -r..=r {
        for xx in -r..=r {
            if xx * xx + yy * yy <= r * r {
                tray_set_px(&mut buf, w, h, cx + xx, cy + yy, dot);
            }
        }
    }

    // 倒计时文字：先描暗边再填亮字，保证浅/深色菜单栏都可读
    let txt_x0 = (pad + dot_d + 3) * s;
    let txt_y0 = (2 * s) as i32;
    for (i, ch) in chars.iter().enumerate() {
        let glyph = TRAY_FONT.iter().find(|(c, _)| c == ch).map(|(_, g)| g);
        if let Some(g) = glyph {
            for row in 0..gh {
                for col in 0..gw {
                    if (g[row as usize] >> (gw - 1 - col)) & 1 == 1 {
                        let px = (txt_x0 + (i as u32) * (gw + gap) * s + col * s) as i32;
                        let py = txt_y0 + (row * s) as i32;
                        for d in [
                            (-1, 0),
                            (1, 0),
                            (0, -1),
                            (0, 1),
                            (-1, -1),
                            (1, 1),
                            (-1, 1),
                            (1, -1),
                        ] {
                            tray_set_px(&mut buf, w, h, px + d.0, py + d.1, outline);
                        }
                        tray_set_px(&mut buf, w, h, px, py, txt_color);
                    }
                }
            }
        }
    }

    Image::new_owned(buf, w, h)
}

/// 解析前端推送的标题（如「🍅 24:59」），渲染并刷新托盘图标。
/// 同时把 set_title 清空，避免「图标文字 + 标题文字」重复显示。
/// 末尾 eprintln 便于真机在 tauri:dev 终端确认推送是否到达（逐秒一行）。
pub fn paint_tray_title(app: &AppHandle, title: &str) {
    // 圆点只有「专注红 / 休息绿」两态，与顶栏胶囊 TimerCapsule.vue 的 dotColor 严格同色，
    // 保证同一时刻菜单栏与工作台传达的状态完全一致（此前小憩用蓝色，两处会打架）。
    let dot = if title.starts_with("🌴") || title.starts_with("☕") {
        (52, 199, 89) // 休息：薄荷绿 #34C759
    } else {
        (255, 107, 53) // 专注：番茄珊瑚红 #FF6B35
    };
    let text = title.split_whitespace().last().unwrap_or("25:00");
    let img = render_time_icon(text, dot);
    if let Some(t) = app.tray_by_id("pomodoro_tray") {
        let _ = t.set_icon(Some(img));
        let _ = t.set_title(None::<String>);
        append_pomodoro_log(&format!("[pomodoro] PAINTED -> {title}"));
    } else {
        append_pomodoro_log("[pomodoro] TRAY_NONE: tray_by_id('pomodoro_tray') returned None");
    }
}

const TRAY_ID: &str = "pomodoro_tray";

/// 在 setup 阶段创建菜单栏番茄钟指示器（倒计时图标 + 右键菜单 + 左键回主窗口）。
pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    // 1) 托盘图标：复用应用默认图标（tauri.conf.json 的 icon），转成自有数据避免生命周期纠缠。
    let icon = app
        .default_window_icon()
        .map(|i| Image::new_owned(i.rgba().to_vec(), i.width(), i.height()))
        .unwrap_or_else(|| Image::new_owned(vec![0, 0, 0, 0], 1, 1));

    // 2) 右键上下文菜单（左键回主窗口，见下方 show_menu_on_left_click(false)）
    let show_main = MenuItemBuilder::with_id("tray_show_main", "显示主窗口").build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("tray_quit", "退出").build(app)?;
    let items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&show_main, &sep, &quit];
    let menu = MenuBuilder::new(app).items(&items).build()?;

    // 3) 左键点击处理器需要 AppHandle 克隆体
    let app_click = app.clone();

    // 4) 建托盘：应用图标 + 一个初始的倒计时图标（圆点 + 25:00），
    //    前端 init / 每秒 tick 会持续刷新；文本标题设为空（倒计时文字画进图标）。
    let _tray = TrayIconBuilder::with_id(TRAY_ID.to_string())
        .icon(icon)
        .tooltip("🍅 番茄钟 · 点击回到工作台")
        .menu(&menu)
        // 左键不弹菜单，只触发 on_tray_icon_event（用于激活主窗口）；右键才弹上面菜单
        .show_menu_on_left_click(false)
        .on_menu_event(|app_h, event| match event.id().as_ref() {
            "tray_show_main" => crate::focus_main_window(app_h),
            "tray_quit" => app_h.exit(0),
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            // 左键点击状态栏倒计时 → 激活并前置主工作台窗口（控制台在顶栏胶囊里）。
            //
            // 仍然只在「左键松开」时响应：macOS 上按下/松开各派发一次 Click
            // （button_state 分别为 Down/Up），不加状态过滤会一次物理点击触发两遍。
            // 这条约束是原弹窗 toggle 时代踩出来的坑（按住出现、松开消失），
            // 现在虽然动作幂等（show + focus 做两次也无副作用），但保留过滤更省事件。
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::focus_main_window(&app_click);
            }
        })
        .build(app)?;

    // 4.5) 初始倒计时图标（圆点 + 25:00）；后续由 store 的 init / tick 持续刷新
    paint_tray_title(app, "🍅 25:00");

    // 5) 监听前端每秒推送的标题，刷新菜单栏（画进图标位图，规避 set_title 不重绘坑）
    let app_title = app.clone();
    app.clone().listen("tray:update", move |event| {
        let v: serde_json::Value =
            serde_json::from_str(event.payload()).unwrap_or(serde_json::Value::Null);
        let title = v
            .get("title")
            .and_then(|x| x.as_str())
            .unwrap_or("🍅 25:00");
        crate::tray::paint_tray_title(&app_title, title);
    });

    Ok(())
}
