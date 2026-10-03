fn main() {
    #[cfg(windows)]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let icon = "../apps/desktop/src-tauri/icons/icon.ico";
        println!("cargo:rerun-if-changed={icon}");
        tauri_winres::WindowsResource::new()
            .set_icon(icon)
            .set("ProductName", "WorkBuddy BYOK")
            .set("FileDescription", "WorkBuddy BYOK Server")
            .compile_for(&["workbuddy-server"])
            .expect("failed to embed the WorkBuddy server icon");
    }
}
