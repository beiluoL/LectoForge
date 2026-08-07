// src-tauri/src/tray.rs
//
// macOS 菜单栏（状态栏）番茄钟：
// - 常驻一个计时器图标 + 实时剩余时间（MM:SS），无需打开主窗口即可看到倒计时；
// - 左键点击展开快捷菜单：开始/暂停、重置、切换 专注/小憩/长休息、显示/隐藏主窗口、退出；
// - 前端计时引擎每秒 emit `pomodoro:update`，这里把时间重绘进图标、刷新提示文案与「开始/暂停」文案；
// - 阶段结束前端 emit `pomodoro:finished`，这里弹出原生系统通知（macOS Notification Center）。
//
// 计时逻辑完全在渲染进程（pomodoroStore）里跑——即便主窗口被隐藏，隐藏的 WebView 仍在执行 JS，
// 时间戳差值法保证后台节流/休眠也不掉秒，托盘图标照常更新。

use serde_json::json;
use tauri::{
    image::Image,
    menu::{IsMenuItem, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Listener, Manager,
};
use tauri::AppHandle;

const TRAY_ID: &str = "pomodoro_tray";

/// 在 setup 阶段创建菜单栏番茄钟（图标 + 菜单 + 事件监听）。
pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    // 1) 菜单项
    let toggle = MenuItemBuilder::with_id("pomo_toggle", "▶ 开始").build(app)?;
    let reset = MenuItemBuilder::with_id("pomo_reset", "重置").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let work = MenuItemBuilder::with_id("pomo_work", "🍅 专注").build(app)?;
    let short = MenuItemBuilder::with_id("pomo_short", "☕ 小憩").build(app)?;
    let long = MenuItemBuilder::with_id("pomo_long", "🌴 长休息").build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let show = MenuItemBuilder::with_id("pomo_show", "显示主窗口").build(app)?;
    let hide = MenuItemBuilder::with_id("pomo_hide", "隐藏主窗口").build(app)?;
    let quit = MenuItemBuilder::with_id("pomo_quit", "退出").build(app)?;

    // 不同菜单项类型混排需统一为 trait object 切片
    let items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![
        &toggle, &reset, &sep1, &work, &short, &long, &sep2, &show, &hide, &quit,
    ];
    let menu = MenuBuilder::new(app).items(&items).build()?;

    // 2) 初始图标（25:00 占位；前端 init 后会立刻推送真实值）
    let icon = render_timer_icon(25, 0, "work");

    // 3) 为托盘图标刷新 / 通知分别克隆 AppHandle（on_menu_event 第一个参数即 &AppHandle，直接用）
    let app_update_inner = app.clone();
    let toggle_item = toggle.clone();

    // 4) 建托盘
    let _tray = TrayIconBuilder::with_id(TRAY_ID.to_string())
        .icon(icon)
        .tooltip("🍅 番茄钟 · 点击开始专注")
        .menu(&menu)
        .on_menu_event(|app_h, event| match event.id().as_ref() {
            "pomo_toggle" => {
                let _ = app_h.emit("pomodoro:control", json!({ "action": "toggle" }));
            }
            "pomo_reset" => {
                let _ = app_h.emit("pomodoro:control", json!({ "action": "reset" }));
            }
            "pomo_work" => {
                let _ = app_h.emit(
                    "pomodoro:control",
                    json!({ "action": "switch", "phase": "work" }),
                );
            }
            "pomo_short" => {
                let _ = app_h.emit(
                    "pomodoro:control",
                    json!({ "action": "switch", "phase": "short_break" }),
                );
            }
            "pomo_long" => {
                let _ = app_h.emit(
                    "pomodoro:control",
                    json!({ "action": "switch", "phase": "long_break" }),
                );
            }
            "pomo_show" => {
                if let Some(w) = app_h.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "pomo_hide" => {
                if let Some(w) = app_h.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            "pomo_quit" => app_h.exit(0),
            _ => {}
        })
        .build(app)?;

    // 5) 监听前端倒计时，刷新图标 + 提示文案 + 「开始/暂停」文案
    app.clone().listen("pomodoro:update", move |event| {
        let v: serde_json::Value =
            serde_json::from_str(event.payload()).unwrap_or(serde_json::Value::Null);
        let time_left = v.get("timeLeft").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
        let phase = v.get("phase").and_then(|x| x.as_str()).unwrap_or("work");
        let is_running = v.get("isRunning").and_then(|x| x.as_bool()).unwrap_or(false);

        let mm = (time_left / 60).min(99);
        let ss = time_left % 60;
        let icon = render_timer_icon(mm, ss, phase);
        if let Some(tray) = app_update_inner.tray_by_id(TRAY_ID) {
            let _ = tray.set_icon(Some(icon));
            let _ = tray.set_tooltip(Some(format!(
                "🍅 {} {}:{:02}",
                phase_label_cn(phase),
                mm,
                ss
            )));
        }
        let _ = toggle_item.set_text(if is_running { "⏸ 暂停" } else { "▶ 开始" });
    });

    // 6) 计时结束 → 原生系统通知（仅 macOS 走 Notification Center；其它平台静默）
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_notification::NotificationExt;
        let app_finish = app.clone();
        app.clone().listen("pomodoro:finished", move |event| {
            let v: serde_json::Value =
                serde_json::from_str(event.payload()).unwrap_or(serde_json::Value::Null);
            let finished = v.get("phase").and_then(|x| x.as_str()).unwrap_or("work");
            let is_set_end = v.get("isSetEnd").and_then(|x| x.as_bool()).unwrap_or(false);
            let count = v.get("count").and_then(|x| x.as_u64()).unwrap_or(0);
            let body = if finished == "work" {
                if is_set_end {
                    format!("完成第 {count} 个番茄，一组结束，去长休息吧 🌴")
                } else {
                    format!("完成第 {count} 个番茄，休息一下 ☕")
                }
            } else {
                "休息结束，开始下一段专注 💪".to_string()
            };
            let _ = app_finish
                .notification()
                .builder()
                .title("🍅 番茄钟")
                .body(body)
                .show();
        });
    }

    Ok(())
}

/* ===================== 图标渲染：3x5 点阵字体 + 阶段色点 ===================== */

fn phase_label_cn(phase: &str) -> &'static str {
    match phase {
        "work" => "专注中",
        "short_break" => "小憩中",
        "long_break" => "长休息",
        _ => "番茄钟",
    }
}

fn phase_color(phase: &str) -> (u8, u8, u8) {
    match phase {
        "work" => (229, 72, 77),        // 番茄红
        "short_break" => (245, 158, 11), // 琥珀橙
        "long_break" => (34, 197, 94),   // 绿
        _ => (150, 150, 150),
    }
}

/// 3x5 点阵字体（bit2=左列, bit1=中列, bit0=右列）
fn glyph(ch: char) -> [u8; 5] {
    match ch {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b001, 0b001, 0b001],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        ':' => [0b000, 0b010, 0b000, 0b010, 0b000],
        _ => [0b000, 0b000, 0b000, 0b000, 0b000],
    }
}

fn set_px(buf: &mut [u8], w: u32, x: u32, y: u32, c: (u8, u8, u8), a: u8) {
    if x >= w {
        return;
    }
    let idx = (y * w + x) as usize * 4;
    if idx + 3 >= buf.len() {
        return;
    }
    buf[idx] = c.0;
    buf[idx + 1] = c.1;
    buf[idx + 2] = c.2;
    buf[idx + 3] = a;
}

fn draw_dot(buf: &mut [u8], w: u32, h: u32, cx: u32, cy: u32, rad: u32, c: (u8, u8, u8)) {
    let r = rad as i32;
    for y in 0..h {
        for x in 0..w {
            let dx = x as i32 - cx as i32;
            let dy = y as i32 - cy as i32;
            let d2 = dx * dx + dy * dy;
            if d2 <= r * r {
                let a = if d2 <= (r - 1) * (r - 1) { 255 } else { 140 };
                set_px(buf, w, x, y, c, a);
            }
        }
    }
}

fn draw_glyph(
    buf: &mut [u8],
    w: u32,
    scale: u32,
    x0: u32,
    y0: u32,
    ch: char,
    c: (u8, u8, u8),
) {
    let g = glyph(ch);
    for row in 0..5u32 {
        for col in 0..3u32 {
            if (g[row as usize] >> (2 - col)) & 1 == 1 {
                for sy in 0..scale {
                    for sx in 0..scale {
                        set_px(
                            buf,
                            w,
                            x0 + col * scale + sx,
                            y0 + row * scale + sy,
                            c,
                            255,
                        );
                    }
                }
            }
        }
    }
}

/// 渲染菜单栏图标：左侧阶段色点 + 右侧 MM:SS 黑字（透明底，macOS 菜单栏直接显示）。
/// 画布按 @2x 尺寸给出（高度 44px ≈ 菜单栏 22pt），Retina 下清晰。
pub fn render_timer_icon(minutes: u32, seconds: u32, phase: &str) -> Image<'_> {
    let scale: u32 = 4;
    let h: u32 = 44;
    let w: u32 = 124;
    let mut buf = vec![0u8; (w * h * 4) as usize];

    // 阶段色点（番茄红 / 琥珀 / 绿）
    let c = phase_color(phase);
    draw_dot(&mut buf, w, h, 16, 22, 9, c);

    // 文本 "MM:SS"
    let text = format!("{minutes:02}:{seconds:02}");
    let color = (30u8, 30u8, 30u8);
    let y_top = (h - 5 * scale) / 2; // 垂直居中
    let mut x = 38;
    for ch in text.chars() {
        draw_glyph(&mut buf, w, scale, x, y_top, ch, color);
        x += if ch == ':' { 3 * scale + 3 } else { 3 * scale + 5 };
    }

    Image::new_owned(buf, w, h)
}
