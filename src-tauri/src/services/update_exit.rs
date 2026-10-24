use crate::store::AppState;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Default)]
pub struct UpdateExitState(Mutex<ExitState>);

#[derive(Default)]
struct ExitState {
    active_updates: usize,
    confirming: bool,
    approved: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum ExitDecision {
    Allow,
    Confirm,
    Wait,
}

pub struct UpdateGuard<'a> {
    state: &'a UpdateExitState,
}

impl Drop for UpdateGuard<'_> {
    fn drop(&mut self) {
        self.state.0.lock().unwrap().active_updates -= 1;
    }
}

impl UpdateExitState {
    pub fn start_update(&self) -> UpdateGuard<'_> {
        self.0.lock().unwrap().active_updates += 1;
        UpdateGuard { state: self }
    }

    #[cfg(test)]
    fn is_updating(&self) -> bool {
        self.0.lock().unwrap().active_updates > 0
    }

    fn should_preserve_window(&self) -> bool {
        let state = self.0.lock().unwrap();
        state.active_updates > 0 || state.confirming
    }

    fn request_exit(&self) -> ExitDecision {
        let mut state = self.0.lock().unwrap();
        if std::mem::take(&mut state.approved) {
            ExitDecision::Allow
        } else if state.confirming {
            ExitDecision::Wait
        } else if state.active_updates > 0 {
            state.confirming = true;
            ExitDecision::Confirm
        } else {
            ExitDecision::Allow
        }
    }

    fn answer(&self, confirmed: bool) {
        let mut state = self.0.lock().unwrap();
        state.confirming = false;
        state.approved = confirmed;
    }
}

#[derive(serde::Deserialize)]
struct ExitLabels {
    title: String,
    message: String,
    quit: String,
    cancel: String,
}

fn exit_labels(language: &str) -> ExitLabels {
    let json = if language == "zh" {
        include_str!("../../../src/i18n/zh.json")
    } else {
        include_str!("../../../src/i18n/en.json")
    };
    let translations: serde_json::Value =
        serde_json::from_str(json).expect("bundled translations are valid JSON");
    serde_json::from_value(translations["updateExitDialog"].clone())
        .expect("bundled exit dialog translations are complete")
}

pub fn handle_run_event(app: &AppHandle, event: RunEvent) {
    let state = app.state::<AppState>();
    match event {
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if state.update_exit.should_preserve_window() => {
            // Keep the WebView alive until the user approves a real exit.
            api.prevent_close();
            app.exit(0);
        }
        // Tauri explicitly ignores prevent_exit for restart requests.
        RunEvent::ExitRequested { api, code, .. } if code != Some(tauri::RESTART_EXIT_CODE) => {
            match state.update_exit.request_exit() {
                ExitDecision::Allow => {}
                ExitDecision::Wait => api.prevent_exit(),
                ExitDecision::Confirm => {
                    api.prevent_exit();
                    let labels = exit_labels(super::tray::current_language_code(app));
                    let handle = app.clone();
                    app.dialog()
                        .message(labels.message)
                        .title(labels.title)
                        .kind(MessageDialogKind::Warning)
                        .buttons(MessageDialogButtons::OkCancelCustom(
                            labels.quit,
                            labels.cancel,
                        ))
                        .show(move |confirmed| {
                            handle.state::<AppState>().update_exit.answer(confirmed);
                            if confirmed {
                                handle.exit(code.unwrap_or(0));
                            }
                        });
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_and_finished_updates_allow_exit() {
        let state = UpdateExitState::default();
        assert_eq!(state.request_exit(), ExitDecision::Allow);
        let guard = state.start_update();
        assert!(state.is_updating());
        drop(guard);
        assert!(!state.is_updating());
        assert_eq!(state.request_exit(), ExitDecision::Allow);
    }

    #[test]
    fn active_update_confirms_once_and_cancel_preserves_it() {
        let state = UpdateExitState::default();
        let _guard = state.start_update();
        assert_eq!(state.request_exit(), ExitDecision::Confirm);
        assert_eq!(state.request_exit(), ExitDecision::Wait);
        state.answer(false);
        assert!(state.is_updating());
        assert_eq!(state.request_exit(), ExitDecision::Confirm);
        state.answer(true);
        assert_eq!(state.request_exit(), ExitDecision::Allow);
        // Approval applies only to the reissued request.
        assert_eq!(state.request_exit(), ExitDecision::Confirm);
    }

    #[test]
    fn completion_during_confirmation_does_not_stack_dialogs() {
        let state = UpdateExitState::default();
        let first = state.start_update();
        let second = state.start_update();
        drop(first);
        assert!(state.is_updating());
        assert_eq!(state.request_exit(), ExitDecision::Confirm);
        drop(second);
        assert!(state.should_preserve_window());
        assert_eq!(state.request_exit(), ExitDecision::Wait);
        state.answer(false);
        assert!(!state.should_preserve_window());
        assert_eq!(state.request_exit(), ExitDecision::Allow);
    }

    #[test]
    fn bundled_native_dialog_labels_cover_both_languages() {
        assert_eq!(exit_labels("en").cancel, "Keep going");
        assert_eq!(
            exit_labels("zh").message,
            "安装、更新或归档操作正在进行，确定退出？"
        );
    }
}
