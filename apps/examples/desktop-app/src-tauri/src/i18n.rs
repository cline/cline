//! Native-shell translations.
//!
//! The desktop's native surfaces (tray menu, macOS application menu, updater
//! labels, tooltips) must be localized even before the webview loads, and the
//! webview cannot hand them their strings synchronously at startup. This
//! module therefore embeds the same catalogs the webview uses
//! (`sdk/packages/i18n/locales/*.json`, via `include_str!`) and resolves labels
//! from the active locale with an English fallback.
//!
//! The language preference itself is owned by the sidecar
//! (`~/.cline/data/settings/code-settings.json`, `language` field). At startup
//! we read that file directly; at runtime the webview pushes the resolved
//! locale via the `set_app_language` command.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;

const EN_JSON: &str = include_str!("../../../../../sdk/packages/i18n/locales/en.json");
const ZH_HANS_JSON: &str =
	include_str!("../../../../../sdk/packages/i18n/locales/zh-Hans.json");

/// Locales this binary can render natively. Anything else falls back to English.
pub const SUPPORTED: [&str; 2] = ["en", "zh-Hans"];

type Catalog = HashMap<String, String>;

fn catalog(json: &str) -> Catalog {
	serde_json::from_str::<Catalog>(json).unwrap_or_default()
}

fn catalogs() -> &'static (Catalog, Catalog) {
	static CATALOGS: OnceLock<(Catalog, Catalog)> = OnceLock::new();
	CATALOGS.get_or_init(|| (catalog(EN_JSON), catalog(ZH_HANS_JSON)))
}

/// Index into `SUPPORTED` for the active native locale (0 = English default).
static LOCALE_INDEX: AtomicUsize = AtomicUsize::new(0);

/// Switch the native locale. Unknown locales fall back to English.
pub fn set_locale(locale: &str) {
	let index = SUPPORTED
		.iter()
		.position(|supported| *supported == locale)
		.unwrap_or(0);
	LOCALE_INDEX.store(index, Ordering::Relaxed);
}

/// The active native locale (defaults to English).
pub fn locale() -> &'static str {
	SUPPORTED[LOCALE_INDEX.load(Ordering::Relaxed)]
}

/// Translate `key` in the active locale, falling back to English, then to the
/// key itself (so a missing key is visible rather than silently empty).
pub fn text(key: &str) -> String {
	let (en, other) = catalogs();
	let active = if locale() == "zh-Hans" {
		other
	} else {
		en
	};
	if let Some(value) = active.get(key) {
		return value.clone();
	}
	if let Some(value) = en.get(key) {
		return value.clone();
	}
	key.to_string()
}

/// Replace `{name}` placeholders in a template.
pub fn format(template: &str, pairs: &[(&str, String)]) -> String {
	let mut out = template.to_string();
	for (name, value) in pairs {
		out = out.replace(&format!("{{{}}}", name), value);
	}
	out
}

/// Session-count line for the tray menu (`1 session running` / `N …`).
pub fn sessions_running_text(count: u32) -> String {
	if count == 1 {
		text("native.tray.sessionRunningOne")
	} else {
		format(
			&text("native.tray.sessionRunningCount"),
			&[("count", count.to_string())],
		)
	}
}

/// Resolve the persisted language preference from the sidecar-owned settings
/// file (`$CLINE_DIR/data/settings/code-settings.json`, defaulting to
/// `$HOME/.cline`). Returns `None` when unset/unreadable.
pub fn persisted_language() -> Option<String> {
	let base = std::env::var("CLINE_DIR").ok().unwrap_or_else(home_dir);
	let path: PathBuf = PathBuf::from(base)
		.join("data")
		.join("settings")
		.join("code-settings.json");
	let raw = std::fs::read_to_string(path).ok()?;
	let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
	let language = value.get("language")?.as_str()?.to_string();
	if language == "system" {
		return None;
	}
	Some(language)
}

fn home_dir() -> String {
	std::env::var("USERPROFILE")
		.or_else(|_| std::env::var("HOME"))
		.unwrap_or_default()
}
