// src-tauri/src/tray.rs
//
// macOS 菜单栏（状态栏）番茄钟 —— 纯菜单栏应用形态：
// - 状态栏常驻一个图标 + 文本标题（如「🍅 24:59」），文本每秒由前端 emit `tray:update` 刷新；
// - 左键点击：展开/收起毛玻璃弹窗（pomodoro_popup 窗口），核心操作都在弹窗里完成；
// - 右键点击：弹出原生菜单（显示主窗口 / 退出）；
// - 计时结束的原生通知由前端直接 invoke `trigger_notification` 命令，不经过此模块。
//
// 计时逻辑完全在渲染进程（pomodoroStore）里跑——弹窗即便被隐藏（window.hide），
// 隐藏的 WebView 仍在执行 JS，时间戳差值法保证后台节流/休眠也不掉秒，标题照常更新。

use tauri::{
    image::Image,
    menu::{IsMenuItem, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Listener, Manager,
};
use tauri::AppHandle;

const TRAY_ID: &str = "pomodoro_tray";

/// 左键点击：切换 pomodoro_popup 弹窗的可见性（可见则隐藏，不可见则居中并前台显示）。
fn toggle_popup(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("pomodoro_popup") {
        match w.is_visible() {
            Ok(true) => {
                let _ = w.hide();
            }
            _ => {
                let _ = w.center();
                let _ = w.show();
                let _ = w.set_focus();
                // 记录本次 show 时刻：供 lib.rs 的 Focused(false) 做「显示后宽限期」去抖，
                // 挡掉 macOS 因点击菜单栏把焦点让回而触发的伪失焦（否则弹窗刚弹出就消失）。
                if let Some(g) = crate::POPUP_SHOWN_AT.get() {
                    *g.lock().unwrap() = std::time::Instant::now();
                }
            }
        }
    }
}

/// 在 setup 阶段创建菜单栏番茄钟（图标 + 文本标题 + 点击交互 + 实时标题刷新）。
pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    // 1) 托盘图标：复用应用默认图标（tauri.conf.json 的 icon），转成自有数据避免生命周期纠缠。
    let icon = app
        .default_window_icon()
        .map(|i| Image::new_owned(i.rgba().to_vec(), i.width(), i.height()))
        .unwrap_or_else(|| Image::new_owned(vec![0, 0, 0, 0], 1, 1));

    // 2) 右键上下文菜单（左键用于切换弹窗，见下方 show_menu_on_left_click(false)）
    let show_main = MenuItemBuilder::with_id("tray_show_main", "显示主窗口").build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("tray_quit", "退出").build(app)?;
    let items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&show_main, &sep, &quit];
    let menu = MenuBuilder::new(app).items(&items).build()?;

    // 3) 左键点击处理器需要 AppHandle 克隆体
    let app_toggle = app.clone();

    // 4) 建托盘：静态图标 + 文本标题「🍅 25:00」（前端 init 后立即推送真实值）
    let _tray = TrayIconBuilder::with_id(TRAY_ID.to_string())
        .icon(icon)
        .tooltip("🍅 番茄钟 · 点击展开控制面板")
        .title("🍅 25:00")
        .menu(&menu)
        // 左键不弹菜单，只触发 on_tray_icon_event（用于切换弹窗）；右键才弹上面菜单
        .show_menu_on_left_click(false)
        .on_menu_event(|app_h, event| match event.id().as_ref() {
            "tray_show_main" => {
                if let Some(w) = app_h.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "tray_quit" => app_h.exit(0),
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            // 仅「左键松开」时切换弹窗。macOS 上按下/松开各派发一次 Click
            // （button_state 分别为 Down/Up），若不加状态过滤会触发两次 toggle：
            // 按下 show、松开 hide —— 表现为「按住出现、松开消失」。
            // 只在 Up 触发可保证一次物理点击仅 toggle 一次
            // （Windows/Linux 通常也只在松开时派发 Click，跨平台一致）。
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popup(&app_toggle);
            }
        })
        .build(app)?;

    // 5) 监听前端每秒推送的标题，刷新菜单栏文本（macOS 状态栏原生显示）
    let app_title = app.clone();
    app.clone().listen("tray:update", move |event| {
        let v: serde_json::Value =
            serde_json::from_str(event.payload()).unwrap_or(serde_json::Value::Null);
        let title = v
            .get("title")
            .and_then(|x| x.as_str())
            .unwrap_or("🍅 25:00");
        if let Some(t) = app_title.tray_by_id(TRAY_ID) {
            let _ = t.set_title(Some(title));
        }
    });

    Ok(())
}
