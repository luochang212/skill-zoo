use std::path::Path;
use tauri::AppHandle;

/// Open a directory in the system file manager.
///
/// On macOS this goes through NSWorkspace's file-viewer activation instead of
/// `open`-style LaunchServices activation: the latter activates the Finder
/// application, pulling every open Finder window to the front, while the
/// former raises only the window showing `dir`.
///
/// Semantics differ from opening a window: the parent directory is revealed
/// with `dir` selected, so a newly created empty directory shows its parent.
/// Errors are not observable on macOS because the NSWorkspace API returns void, so
/// this reports `Ok(())` regardless of whether activation happened.
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
