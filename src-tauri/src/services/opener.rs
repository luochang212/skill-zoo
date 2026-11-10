use std::path::Path;
use tauri::AppHandle;

pub fn open_directory(app: &AppHandle, dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSWorkspace;
        use objc2_foundation::{NSArray, NSString, NSURL};

        let _ = app;
        let path = NSString::from_str(&dir.to_string_lossy());
        let url = NSURL::fileURLWithPath_isDirectory(&path, true);
        let urls = NSArray::from_slice(&[&*url]);
        NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&urls);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_opener::OpenerExt;

        app.opener()
            .open_path(dir.to_string_lossy(), None::<&str>)
            .map_err(|e| e.to_string())
    }
}
