// 显式声明本应用注册的全部自定义命令，让 Tauri 在构建期为它们生成
// `allow-<命令名转 kebab-case>` 权限文件（如 allow-update-tray-title），
// 这样 capabilities 才能授予前端调用这些命令的权限。
// 否则 release 构建下 invoke 会被 ACL 拒绝（"Command xxx not allowed by ACL"），
// 表现为菜单栏倒计时推不出去、重启引擎/选目录/检查更新/外链/退出等全部失效。
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new()            .commands(&[
                "update_tray_title",
                "trigger_notification",
                "restart_sidecar",
                "select_directory",
                "capture_screenshot",
                "check_for_update",
                "open_external_url",
                "quit_app",
                "take_pending_deep_link",
                "create_backup",
                "set_backup_schedule",
                "get_backup_schedule",
                "open_backup_folder",
                "list_backups",
            ]),
        ),
    )
    .unwrap();
}
