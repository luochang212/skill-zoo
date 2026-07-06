use crate::persistence::Settings;
use crate::services::skill_usage::{self, RecentSkillUsage};
use crate::store::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, Wry};

pub const SKILL_COMPANION_ITEMS_SETTING: &str = "skill_companion_items";

const TRAY_ID: &str = "skill-zoo-tray";
const MENU_OPEN: &str = "tray-open";
const MENU_SETTINGS: &str = "tray-settings";
const MENU_QUIT: &str = "tray-quit";
const NAVIGATE_EVENT: &str = "navigate";
const MENU_COMPANION_COPY_HINT: &str = "skill-companion-copy-hint";
const MENU_COMPANION_EMPTY: &str = "skill-companion-empty";
const COMPANION_MENU_ID: &str = "skill-companion-menu";
const COMPANION_MENU_PREFIX: &str = "skill-companion:";
const MENU_RECENT_COPY_HINT: &str = "skill-recent-copy-hint";
const MENU_RECENT_EMPTY: &str = "skill-recent-empty";
const RECENT_MENU_ID: &str = "skill-recent-menu";
const RECENT_MENU_PREFIX: &str = "skill-recent:";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCompanionItem {
    pub id: String,
    pub content: String,
}

#[derive(Default)]
pub struct TrayState {
    root_menu: Mutex<Option<Menu<Wry>>>,
    open_item: Mutex<Option<MenuItem<Wry>>>,
    settings_item: Mutex<Option<MenuItem<Wry>>>,
    quit_item: Mutex<Option<MenuItem<Wry>>>,
    companion_menu: Mutex<Option<Submenu<Wry>>>,
    recent_menu: Mutex<Option<Submenu<Wry>>>,
    language: Mutex<TrayLanguage>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
enum TrayLanguage {
    #[default]
    En,
    Zh,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrayLabels {
    open_main_window: &'static str,
    settings: &'static str,
    skill_companion: &'static str,
    recent_skills: &'static str,
    copy_hint: &'static str,
    empty_companion: &'static str,
    empty_recent: &'static str,
    quit: &'static str,
}

impl TrayLanguage {
    fn from_code(language: &str) -> Self {
        if language.to_ascii_lowercase().starts_with("zh") {
            Self::Zh
        } else {
            Self::En
        }
    }

    pub fn labels(self) -> TrayLabels {
        match self {
            Self::En => TrayLabels {
                open_main_window: "Open main window",
                settings: "Settings",
                skill_companion: "Common Commands",
                recent_skills: "Recently Used",
                copy_hint: "Click an item to copy",
                empty_companion: "No common commands configured",
                empty_recent: "No recent skills",
                quit: "Quit",
            },
            Self::Zh => TrayLabels {
                open_main_window: "打开主界面",
                settings: "设置",
                skill_companion: "常用指令",
                recent_skills: "最近使用",
                copy_hint: "点击条目即可复制",
                empty_companion: "还没有添加常用指令",
                empty_recent: "暂无最近使用",
                quit: "退出",
            },
        }
    }
}

pub fn parse_skill_companion_items(settings: &Settings) -> Vec<SkillCompanionItem> {
    settings
        .get(SKILL_COMPANION_ITEMS_SETTING)
        .and_then(|json| serde_json::from_str::<Vec<SkillCompanionItem>>(json).ok())
        .unwrap_or_default()
}

pub fn validate_skill_companion_items(items: &[SkillCompanionItem]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for item in items {
        if item.id.trim().is_empty() {
            return Err("Skill companion item id cannot be empty".to_string());
        }
        if item.content.trim().is_empty() {
            return Err("Skill companion item content cannot be empty".to_string());
        }
        if !ids.insert(item.id.as_str()) {
            return Err("Skill companion item ids must be unique".to_string());
        }
    }
    Ok(())
}

pub fn companion_item_id_from_menu_id(menu_id: &str) -> Option<&str> {
    menu_id.strip_prefix(COMPANION_MENU_PREFIX)
}

pub fn recent_skill_name_from_menu_id(menu_id: &str) -> Option<&str> {
    menu_id.strip_prefix(RECENT_MENU_PREFIX)
}

pub fn setup_tray(app: &mut App) -> tauri::Result<()> {
    app.manage(TrayState::default());

    let app_handle = app.handle().clone();
    let labels = TrayLanguage::default().labels();
    let companion_menu = build_companion_submenu(&app_handle, labels)?;
    let recent_menu = build_recent_submenu(&app_handle, labels)?;
    let open = MenuItem::with_id(
        &app_handle,
        MENU_OPEN,
        labels.open_main_window,
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(
        &app_handle,
        MENU_SETTINGS,
        labels.settings,
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(&app_handle, MENU_QUIT, labels.quit, true, None::<&str>)?;
    let menu = Menu::with_items(
        &app_handle,
        &[
            &open,
            &PredefinedMenuItem::separator(&app_handle)?,
            &companion_menu,
            &recent_menu,
            &PredefinedMenuItem::separator(&app_handle)?,
            &settings,
            &PredefinedMenuItem::separator(&app_handle)?,
            &quit,
        ],
    )?;

    let tray_icon =
        tauri::image::Image::from_bytes(include_bytes!("../../icons/tray-template.png"))?;
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .icon(tray_icon)
        .tooltip("Skill Zoo")
        .show_menu_on_left_click(true)
        .on_menu_event(handle_tray_menu_event);

    #[cfg(target_os = "macos")]
    {
        tray = tray.icon_as_template(true);
    }

    tray.build(app)?;

    let state = app.state::<TrayState>();
    state.root_menu.lock().unwrap().replace(menu);
    state.open_item.lock().unwrap().replace(open);
    state.settings_item.lock().unwrap().replace(settings);
    state.quit_item.lock().unwrap().replace(quit);
    state.companion_menu.lock().unwrap().replace(companion_menu);
    state.recent_menu.lock().unwrap().replace(recent_menu);

    Ok(())
}

pub fn set_tray_language(app: &AppHandle, language: &str) -> Result<(), String> {
    let Some(tray_state) = app.try_state::<TrayState>() else {
        return Ok(());
    };
    let language = TrayLanguage::from_code(language);
    let labels = language.labels();
    {
        let mut current = tray_state.language.lock().map_err(|e| e.to_string())?;
        *current = language;
    }
    if let Some(open_item) = tray_state
        .open_item
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
    {
        open_item
            .set_text(labels.open_main_window)
            .map_err(|e| e.to_string())?;
    }
    if let Some(settings_item) = tray_state
        .settings_item
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
    {
        settings_item
            .set_text(labels.settings)
            .map_err(|e| e.to_string())?;
    }
    if let Some(quit_item) = tray_state
        .quit_item
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
    {
        quit_item.set_text(labels.quit).map_err(|e| e.to_string())?;
    }
    if let Some(companion_menu) = tray_state
        .companion_menu
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
    {
        companion_menu
            .set_text(labels.skill_companion)
            .map_err(|e| e.to_string())?;
    }
    if let Some(recent_menu) = tray_state
        .recent_menu
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
    {
        recent_menu
            .set_text(labels.recent_skills)
            .map_err(|e| e.to_string())?;
    }
    refresh_recent_skills_menu(app)?;
    refresh_skill_companion_menu(app)
}

pub fn refresh_skill_companion_menu(app: &AppHandle) -> Result<(), String> {
    let Some(tray_state) = app.try_state::<TrayState>() else {
        return Ok(());
    };
    let Some(companion_menu) = tray_state.companion_menu.lock().unwrap().clone() else {
        return Ok(());
    };
    let items = {
        let app_state = app.state::<AppState>();
        let settings = app_state.settings.lock().map_err(|e| e.to_string())?;
        parse_skill_companion_items(&settings)
    };
    let language = *tray_state.language.lock().map_err(|e| e.to_string())?;
    replace_companion_menu_items(app, &companion_menu, &items, language.labels())
        .map_err(|e| e.to_string())
}

fn build_companion_submenu(app: &AppHandle, labels: TrayLabels) -> tauri::Result<Submenu<Wry>> {
    let submenu = Submenu::with_id(app, COMPANION_MENU_ID, labels.skill_companion, true)?;
    let items = {
        let app_state = app.state::<AppState>();
        let settings = app_state.settings.lock().expect("settings mutex poisoned");
        parse_skill_companion_items(&settings)
    };
    replace_companion_menu_items(app, &submenu, &items, labels)?;
    Ok(submenu)
}

fn build_recent_submenu(app: &AppHandle, labels: TrayLabels) -> tauri::Result<Submenu<Wry>> {
    let submenu = Submenu::with_id(app, RECENT_MENU_ID, labels.recent_skills, true)?;
    let recent = recent_skill_items(app);
    replace_recent_menu_items(app, &submenu, &recent, labels)?;
    Ok(submenu)
}

fn replace_companion_menu_items(
    app: &AppHandle,
    menu: &Submenu<Wry>,
    items: &[SkillCompanionItem],
    labels: TrayLabels,
) -> tauri::Result<()> {
    while menu.remove_at(0)?.is_some() {}

    let menu_items: Vec<_> = items
        .iter()
        .filter_map(|item| companion_menu_title(&item.content).map(|title| (item, title)))
        .collect();
    if menu_items.is_empty() {
        menu.append(&MenuItem::with_id(
            app,
            MENU_COMPANION_EMPTY,
            labels.empty_companion,
            false,
            None::<&str>,
        )?)?;
        return Ok(());
    }

    for (item, title) in menu_items {
        menu.append(&MenuItem::with_id(
            app,
            format!("{COMPANION_MENU_PREFIX}{}", item.id),
            &title,
            true,
            None::<&str>,
        )?)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        MENU_COMPANION_COPY_HINT,
        labels.copy_hint,
        false,
        None::<&str>,
    )?)?;

    Ok(())
}

pub fn refresh_recent_skills_menu(app: &AppHandle) -> Result<(), String> {
    let Some(tray_state) = app.try_state::<TrayState>() else {
        return Ok(());
    };
    let Some(recent_menu) = tray_state.recent_menu.lock().unwrap().clone() else {
        return Ok(());
    };
    let language = *tray_state.language.lock().map_err(|e| e.to_string())?;
    let recent = recent_skill_items(app);
    replace_recent_menu_items(app, &recent_menu, &recent, language.labels())
        .map_err(|e| e.to_string())
}

fn replace_recent_menu_items(
    app: &AppHandle,
    menu: &Submenu<Wry>,
    recent: &[RecentSkillUsage],
    labels: TrayLabels,
) -> tauri::Result<()> {
    while menu.remove_at(0)?.is_some() {}

    if recent.is_empty() {
        menu.append(&MenuItem::with_id(
            app,
            MENU_RECENT_EMPTY,
            labels.empty_recent,
            false,
            None::<&str>,
        )?)?;
        return Ok(());
    }

    for item in recent {
        menu.append(&MenuItem::with_id(
            app,
            format!("{RECENT_MENU_PREFIX}{}", item.name),
            truncate_menu_title(&item.command),
            true,
            None::<&str>,
        )?)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        MENU_RECENT_COPY_HINT,
        labels.copy_hint,
        false,
        None::<&str>,
    )?)?;

    Ok(())
}

fn recent_skill_items(app: &AppHandle) -> Vec<RecentSkillUsage> {
    let state = app.state::<AppState>();
    let (whitelist, installed_skill_count) = match state.skill_cache.read() {
        Ok(cache) => skill_usage::skill_whitelist(&cache, "claude-code"),
        Err(error) => {
            eprintln!("Failed to read skill cache for recent skills: {error}");
            return Vec::new();
        }
    };
    skill_usage::discover_skill_usage("claude-code", whitelist, installed_skill_count).recent
}

fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    match id {
        MENU_OPEN => show_main_window(app),
        MENU_SETTINGS => {
            show_main_window(app);
            if let Err(error) = app.emit(NAVIGATE_EVENT, "settings") {
                eprintln!("Failed to emit navigate event: {error}");
            }
        }
        MENU_QUIT => app.exit(0),
        _ => {
            if let Some(item_id) = companion_item_id_from_menu_id(id) {
                if let Err(error) = copy_companion_item(app, item_id) {
                    eprintln!("Failed to copy skill companion item: {error}");
                }
            } else if let Some(skill_name) = recent_skill_name_from_menu_id(id) {
                if let Err(error) = copy_recent_skill(skill_name) {
                    eprintln!("Failed to copy recent skill: {error}");
                }
            }
        }
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn copy_companion_item(app: &AppHandle, item_id: &str) -> Result<(), String> {
    let item = {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        parse_skill_companion_items(&settings)
            .into_iter()
            .find(|item| item.id == item_id && !item.content.trim().is_empty())
    };
    let Some(item) = item else {
        return Ok(());
    };

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(item.content).map_err(|e| e.to_string())
}

fn copy_recent_skill(skill_name: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_text(skill_name.to_string())
        .map_err(|e| e.to_string())
}

pub fn companion_menu_title(content: &str) -> Option<String> {
    let first_line = content.lines().find_map(|line| {
        let collapsed = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.is_empty() {
            None
        } else {
            Some(collapsed)
        }
    })?;
    Some(truncate_menu_title(&first_line))
}

fn truncate_menu_title(title: &str) -> String {
    const MAX_CHARS: usize = 36;
    const PREFIX_CHARS: usize = 33;
    if title.chars().count() <= MAX_CHARS {
        return title.to_string();
    }
    format!(
        "{}...",
        title.chars().take(PREFIX_CHARS).collect::<String>()
    )
}

#[cfg(test)]
mod tests {
    use super::{
        companion_item_id_from_menu_id, companion_menu_title, parse_skill_companion_items,
        recent_skill_name_from_menu_id, validate_skill_companion_items, SkillCompanionItem,
        TrayLanguage, SKILL_COMPANION_ITEMS_SETTING,
    };
    use crate::persistence::Settings;
    use std::collections::HashMap;

    fn item(id: &str) -> SkillCompanionItem {
        SkillCompanionItem {
            id: id.to_string(),
            content: "Use this prompt".to_string(),
        }
    }

    #[test]
    fn parse_missing_or_invalid_items_as_empty() {
        let empty = Settings {
            values: HashMap::new(),
        };
        assert!(parse_skill_companion_items(&empty).is_empty());

        let invalid = Settings {
            values: HashMap::from([(SKILL_COMPANION_ITEMS_SETTING.to_string(), "{".to_string())]),
        };
        assert!(parse_skill_companion_items(&invalid).is_empty());
    }

    #[test]
    fn parse_items_from_settings() {
        let settings = Settings {
            values: HashMap::from([(
                SKILL_COMPANION_ITEMS_SETTING.to_string(),
                r#"[{"id":"one","title":"legacy title","content":"Use this prompt","enabled":false}]"#
                    .to_string(),
            )]),
        };
        assert_eq!(parse_skill_companion_items(&settings), vec![item("one")]);
    }

    #[test]
    fn validate_rejects_empty_fields_and_duplicate_ids() {
        assert!(validate_skill_companion_items(&[item("one")]).is_ok());

        let mut empty_content = item("one");
        empty_content.content = " ".to_string();
        assert!(validate_skill_companion_items(&[empty_content]).is_err());

        assert!(validate_skill_companion_items(&[item("one"), item("one")]).is_err());
    }

    #[test]
    fn parses_companion_menu_item_ids() {
        assert_eq!(
            companion_item_id_from_menu_id("skill-companion:abc"),
            Some("abc")
        );
        assert_eq!(companion_item_id_from_menu_id("tray-open"), None);
        assert_eq!(
            recent_skill_name_from_menu_id("skill-recent:code-review"),
            Some("code-review")
        );
        assert_eq!(recent_skill_name_from_menu_id("tray-open"), None);
    }

    #[test]
    fn derives_menu_titles_from_content() {
        assert_eq!(
            companion_menu_title("\n  Review   this code  \nsecond line"),
            Some("Review this code".to_string())
        );
        assert_eq!(companion_menu_title(" \n\t"), None);
        assert_eq!(
            companion_menu_title("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN"),
            Some("abcdefghijklmnopqrstuvwxyzABCDEFG...".to_string())
        );
    }

    #[test]
    fn maps_tray_labels_by_language() {
        let english = TrayLanguage::from_code("en-US").labels();
        assert_eq!(english.open_main_window, "Open main window");
        assert_eq!(english.settings, "Settings");
        assert_eq!(english.skill_companion, "Common Commands");
        assert_eq!(english.recent_skills, "Recently Used");
        assert_eq!(english.copy_hint, "Click an item to copy");
        assert_eq!(english.empty_companion, "No common commands configured");
        assert_eq!(english.empty_recent, "No recent skills");
        assert_eq!(english.quit, "Quit");

        let chinese = TrayLanguage::from_code("zh-CN").labels();
        assert_eq!(chinese.open_main_window, "打开主界面");
        assert_eq!(chinese.settings, "设置");
        assert_eq!(chinese.skill_companion, "常用指令");
        assert_eq!(chinese.recent_skills, "最近使用");
        assert_eq!(chinese.copy_hint, "点击条目即可复制");
        assert_eq!(chinese.empty_companion, "还没有添加常用指令");
        assert_eq!(chinese.empty_recent, "暂无最近使用");
        assert_eq!(chinese.quit, "退出");
    }
}
