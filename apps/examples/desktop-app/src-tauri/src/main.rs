#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod macos_notification;

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_updater::UpdaterExt;

const UPDATE_INITIAL_DELAY: Duration = Duration::from_secs(10);
const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(2 * 60 * 60);
const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ICON_ID: &str = "cline-code";
const TRAY_OPEN_MENU_ID: &str = "tray-open";
const TRAY_NEW_SESSION_MENU_ID: &str = "tray-new-session";
const TRAY_SETTINGS_MENU_ID: &str = "tray-settings";
const TRAY_QUIT_MENU_ID: &str = "tray-quit";
const DESKTOP_ACTION_PENDING_EVENT: &str = "desktop-action-pending";
#[cfg(any(target_os = "macos", test))]
const VIEW_ZOOM_IN_MENU_ID: &str = "view-zoom-in";
#[cfg(any(target_os = "macos", test))]
const VIEW_ZOOM_OUT_MENU_ID: &str = "view-zoom-out";
#[cfg(any(target_os = "macos", test))]
const VIEW_ZOOM_RESET_MENU_ID: &str = "view-zoom-reset";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum DesktopAction {
    NewSession,
    OpenSettings,
    ZoomIn,
    ZoomOut,
    ZoomReset,
    OpenSession {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
}

#[derive(Default)]
struct DesktopActionState {
    pending: Mutex<VecDeque<DesktopAction>>,
}

impl DesktopActionState {
    fn enqueue(&self, action: DesktopAction) {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push_back(action);
    }

    fn drain(&self) -> Vec<DesktopAction> {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .drain(..)
            .collect()
    }
}

struct TrayMenuState {
    status: MenuItem<tauri::Wry>,
    hub_healthy: Mutex<bool>,
    running_sessions: MenuItem<tauri::Wry>,
}

#[derive(Clone)]
struct AppContext {
    launch_cwd: String,
    workspace_root: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    state: String,
    version: Option<String>,
    error: Option<String>,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            version: None,
            error: None,
        }
    }
}

#[derive(Default)]
struct UpdateState {
    status: Mutex<UpdateStatus>,
    // Serializes whole updater cycles. The periodic loop and the on-demand
    // check_for_update_now command run the same check/download/stage cycle;
    // without exclusion, overlapping cycles can download the same bundle
    // concurrently and the later one can overwrite a freshly staged "ready"
    // with "idle"/"error" decided from its stale pre-await snapshot.
    cycle: tokio::sync::Mutex<()>,
}

impl UpdateState {
    fn set(&self, state: &str, version: Option<String>, error: Option<String>) {
        if let Ok(mut guard) = self.status.lock() {
            *guard = UpdateStatus {
                state: state.to_string(),
                version,
                error,
            };
        }
    }

    fn snapshot(&self) -> UpdateStatus {
        self.status
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    fn ready_version(&self) -> Option<String> {
        self.status.lock().ok().and_then(|guard| {
            if guard.state == "ready" {
                guard.version.clone()
            } else {
                None
            }
        })
    }
}

fn tray_status_text(update_status: &UpdateStatus, hub_healthy: bool) -> &'static str {
    match update_status.state.as_str() {
        "checking" => "Status: Checking for Updates",
        "downloading" => "Status: Downloading Update",
        "ready" => "Status: Update Available",
        "error" => "Status: Update Check Failed",
        _ if hub_healthy => "Status: Healthy",
        _ => "Status: Hub Disconnected",
    }
}

fn running_sessions_text(running_sessions: u32) -> String {
    match running_sessions {
        1 => "1 session running".to_string(),
        count => format!("{count} sessions running"),
    }
}

// app_name is package_info().name (the configured productName), so beta
// builds ("Cline Beta") identify themselves in the tooltip too.
fn tray_tooltip_text(app_name: &str, running_sessions: u32) -> String {
    if running_sessions == 0 {
        app_name.to_string()
    } else {
        format!("{app_name} — {}", running_sessions_text(running_sessions))
    }
}

fn tray_badge_text(running_sessions: u32) -> Option<String> {
    (running_sessions > 0).then(|| running_sessions.to_string())
}

fn refresh_tray_status(app: &tauri::AppHandle, update_state: &UpdateState) {
    let tray_menu = app.state::<TrayMenuState>();
    let hub_healthy = tray_menu
        .hub_healthy
        .lock()
        .map(|healthy| *healthy)
        .unwrap_or(false);
    let _ = tray_menu
        .status
        .set_text(tray_status_text(&update_state.snapshot(), hub_healthy));
}

fn set_update_status(
    app: &tauri::AppHandle,
    update_state: &UpdateState,
    state: &str,
    version: Option<String>,
    error: Option<String>,
) {
    update_state.set(state, version, error);
    refresh_tray_status(app, update_state);
}

async fn check_and_install_update(app: &tauri::AppHandle, state: &UpdateState) {
    let _cycle = state.cycle.lock().await;
    // An update that already finished downloading only needs a restart; keep
    // reporting "ready" instead of flipping back to transient states unless a
    // newer version shows up. Reading it under the cycle lock makes the
    // snapshot authoritative for this whole cycle.
    let ready_version = state.ready_version();
    if ready_version.is_none() {
        set_update_status(app, state, "checking", None, None);
    }

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => {
            set_update_status(app, state, "error", None, Some(error.to_string()));
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            if ready_version.as_deref() == Some(version.as_str()) {
                return;
            }
            set_update_status(app, state, "downloading", Some(version.clone()), None);
            match update.download_and_install(|_, _| {}, || {}).await {
                Ok(()) => set_update_status(app, state, "ready", Some(version), None),
                Err(error) => {
                    set_update_status(app, state, "error", Some(version), Some(error.to_string()))
                }
            }
        }
        Ok(None) => {
            if ready_version.is_none() {
                set_update_status(app, state, "idle", None, None);
            }
        }
        Err(error) => {
            if ready_version.is_none() {
                set_update_status(app, state, "error", None, Some(error.to_string()));
            }
        }
    }
}

async fn run_update_loop(app: tauri::AppHandle, state: Arc<UpdateState>) {
    tokio::time::sleep(UPDATE_INITIAL_DELAY).await;
    loop {
        check_and_install_update(&app, &state).await;
        tokio::time::sleep(UPDATE_CHECK_INTERVAL).await;
    }
}

/// Lock order: `process` may be held while acquiring `ws_endpoint`, never
/// the reverse. Anything that touches both (including stop()) must either
/// nest in that order or take them strictly sequentially.
#[derive(Default)]
struct DesktopBackendState {
    ws_endpoint: Mutex<Option<String>>,
    process: Mutex<Option<Child>>,
    shutting_down: Mutex<bool>,
}

impl DesktopBackendState {
    fn is_shutting_down(&self) -> bool {
        self.shutting_down
            .lock()
            .map(|guard| *guard)
            .unwrap_or(true)
    }

    fn stop(&self) {
        if let Ok(mut guard) = self.shutting_down.lock() {
            *guard = true;
        }

        if let Ok(mut process_guard) = self.process.lock() {
            if let Some(child) = process_guard.as_mut() {
                // Quit runs this on the main thread (on macOS inside
                // applicationWillTerminate:, where blocking beach-balls the
                // app), so signal the sidecar and return without waiting.
                // SIGTERM triggers its own bounded graceful shutdown
                // (SHUTDOWN_TIMEOUT_MS in sidecar/index.ts), after which it
                // exits itself, finishing session persistence as an orphan.
                #[cfg(unix)]
                let _ = Command::new("kill").arg(child.id().to_string()).status();
                #[cfg(not(unix))]
                let _ = child.kill();
            }
            *process_guard = None;
        }

        if let Ok(mut endpoint_guard) = self.ws_endpoint.lock() {
            *endpoint_guard = None;
        }
    }
}

impl Drop for DesktopBackendState {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopBackendReadyLine {
    #[serde(rename = "type")]
    line_type: String,
    endpoint: Option<String>,
    ws_endpoint: Option<String>,
    pid: Option<u64>,
    mode: Option<String>,
}

fn resolve_workspace_root(launch_cwd: &str) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(launch_cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output();

    match output {
        Ok(result) if result.status.success() => {
            let value = String::from_utf8_lossy(&result.stdout).trim().to_string();
            if value.is_empty() {
                launch_cwd.to_string()
            } else {
                value
            }
        }
        _ => launch_cwd.to_string(),
    }
}

fn resolve_desktop_backend_script_path(context: &AppContext) -> Option<PathBuf> {
    let launch_cwd = PathBuf::from(&context.launch_cwd);
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("examples")
            .join("desktop-app")
            .join("sidecar")
            .join("index.ts"),
        launch_cwd.join("sidecar").join("index.ts"),
        launch_cwd
            .parent()
            .map(|parent| parent.join("sidecar").join("index.ts"))
            .unwrap_or_else(|| PathBuf::from("")),
        launch_cwd
            .join("apps")
            .join("examples")
            .join("desktop-app")
            .join("sidecar")
            .join("index.ts"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

fn desktop_backend_binary_names() -> Vec<String> {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let bundled_name = format!("code-sidecar{extension}");
    let target_triple = option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or("").trim();
    if target_triple.is_empty() {
        return vec![bundled_name];
    }

    vec![
        bundled_name,
        format!("code-sidecar-{target_triple}{extension}"),
    ]
}

fn resolve_desktop_backend_binary_path(context: &AppContext) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    let explicit = std::env::var("CLINE_CODE_SIDECAR_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let current_exe = std::env::current_exe().ok();
    let mut candidates = Vec::new();
    if let Some(path) = explicit {
        candidates.push(path);
    }

    for binary_name in desktop_backend_binary_names() {
        candidates.push(
            PathBuf::from(&context.workspace_root)
                .join("apps")
                .join("examples")
                .join("desktop-app")
                .join("src-tauri")
                .join("bin")
                .join(&binary_name),
        );
        if let Some(path) = current_exe
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.join(&binary_name)))
        {
            candidates.push(path);
        }
        if let Some(path) = current_exe.as_ref().and_then(|path| {
            path.parent()
                .and_then(|parent| parent.parent())
                .map(|parent| parent.join("Resources").join(&binary_name))
        }) {
            candidates.push(path);
        }
    }

    candidates.into_iter().find(|path| path.exists())
}

fn spawn_desktop_backend_process(context: &AppContext) -> Result<Child, String> {
    let mut command = if let Some(binary_path) = resolve_desktop_backend_binary_path(context) {
        let mut command = Command::new(binary_path);
        command.current_dir(&context.workspace_root);
        command
    } else if let Some(script_path) = resolve_desktop_backend_script_path(context) {
        let mut command = Command::new("bun");
        command
            .arg("run")
            .arg(script_path.to_string_lossy().to_string())
            .current_dir(&context.workspace_root);
        command
    } else {
        return Err(format!(
            "desktop backend sidecar not found. checked binary/script under workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start desktop backend sidecar: {e}"))
}

fn ensure_desktop_backend_started(
    state: &Arc<DesktopBackendState>,
    context: &AppContext,
) -> Result<(), String> {
    ensure_desktop_backend_started_with(state, || spawn_desktop_backend_process(context))
}

fn ensure_desktop_backend_started_with(
    state: &Arc<DesktopBackendState>,
    spawn_backend: impl FnOnce() -> Result<Child, String>,
) -> Result<(), String> {
    if state.is_shutting_down() {
        return Ok(());
    }

    // Hold the process lock for the entire check-and-spawn so concurrent
    // callers (setup, the health-check loop, endpoint fetches from the
    // webview) serialize: the second caller blocks here, then sees the live
    // child and returns instead of spawning a duplicate.
    let mut process_guard = state
        .process
        .lock()
        .map_err(|_| "failed to lock desktop backend process state")?;
    if let Some(existing) = process_guard.as_mut() {
        match existing.try_wait() {
            // A live child owns startup even while its endpoint is still
            // pending (login-shell PATH resolution plus session-manager init
            // take a few seconds). Spawning again here would orphan it and
            // race on the port.
            Ok(None) => return Ok(()),
            Ok(Some(_)) | Err(_) => {
                *process_guard = None;
                if let Ok(mut endpoint_guard) = state.ws_endpoint.lock() {
                    *endpoint_guard = None;
                }
            }
        }
    }

    let mut child = spawn_backend()?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture desktop backend stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture desktop backend stderr".to_string())?;

    let child_pid = child.id();
    let state_for_stdout = state.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            let Ok(bytes) = reader.read_line(&mut line) else {
                break;
            };
            if bytes == 0 {
                break;
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<DesktopBackendReadyLine>(trimmed) {
                if parsed.line_type == "ready" {
                    if let Some(endpoint) = parsed.ws_endpoint.or(parsed.endpoint) {
                        if let Ok(mut endpoint_guard) = state_for_stdout.ws_endpoint.lock() {
                            *endpoint_guard = Some(endpoint);
                        }
                    }
                    continue;
                }
            }
            eprintln!("[desktop-backend] {trimmed}");
        }
        // Only clear the endpoint if this thread's child is still the one
        // being tracked — a late EOF from a replaced child must not wipe the
        // endpoint its successor already published.
        let owns_tracked_child = state_for_stdout
            .process
            .lock()
            .ok()
            .map(|guard| guard.as_ref().map(|child| child.id()) == Some(child_pid))
            .unwrap_or(false);
        if owns_tracked_child {
            if let Ok(mut endpoint_guard) = state_for_stdout.ws_endpoint.lock() {
                *endpoint_guard = None;
            }
        }
    });

    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(text) if !text.trim().is_empty() => {
                    eprintln!("[desktop-backend:err] {}", text.trim());
                }
                _ => {}
            }
        }
    });

    *process_guard = Some(child);
    Ok(())
}

fn resolve_mcp_settings_path() -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("CLINE_MCP_SETTINGS_PATH") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home)
        .join(".cline")
        .join("data")
        .join("settings")
        .join("cline_mcp_settings.json"))
}

fn open_path_with_default_app(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg(path)
            .status()
            .map_err(|e| format!("failed to open path: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("open command exited with status {status}"));
    }

    #[cfg(target_os = "windows")]
    {
        let path_arg = path.to_string_lossy().to_string();
        let status = Command::new("cmd")
            .args(["/C", "start", "", &path_arg])
            .status()
            .map_err(|e| format!("failed to open path: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("start command exited with status {status}"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let status = Command::new("xdg-open")
            .arg(path)
            .status()
            .map_err(|e| format!("failed to open path: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("xdg-open command exited with status {status}"));
    }

    #[allow(unreachable_code)]
    Err("opening files is not supported on this platform".to_string())
}

#[tauri::command]
fn get_desktop_backend_endpoint(
    backend_state: State<'_, Arc<DesktopBackendState>>,
    context: State<'_, AppContext>,
) -> Result<String, String> {
    ensure_desktop_backend_started(backend_state.inner(), context.inner())?;
    // Sidecar startup includes login-shell PATH resolution (bounded at 3s,
    // see sidecar/shell-path.ts) plus session-manager init, whose duration
    // varies by machine. Poll well past that combined worst case; the loop
    // returns as soon as the ready line arrives, so only failure waits long.
    // While pending this only waits — respawning is ensure's job, and it
    // refuses to start a second sidecar while the first one is still alive.
    for _ in 0..150 {
        if let Some(endpoint) = backend_state
            .ws_endpoint
            .lock()
            .ok()
            .and_then(|value| value.as_ref().cloned())
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(endpoint);
        }
        let child_exited = backend_state
            .process
            .lock()
            .ok()
            .map(|mut guard| match guard.as_mut() {
                Some(child) => !matches!(child.try_wait(), Ok(None)),
                None => true,
            })
            .unwrap_or(false);
        if child_exited {
            return Err("desktop backend exited before publishing its endpoint".to_string());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("desktop backend endpoint not ready".to_string())
}

#[tauri::command]
fn pick_workspace_directory(initial_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(path) = initial_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        dialog = dialog.set_directory(path);
    }
    dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_update_status(update_state: State<'_, Arc<UpdateState>>) -> UpdateStatus {
    update_state.snapshot()
}

#[tauri::command]
fn restart_to_apply_update(
    app: tauri::AppHandle,
    backend_state: State<'_, Arc<DesktopBackendState>>,
) {
    // restart() never returns, so the run-loop Exit handler does not get a
    // chance to stop the sidecar; shut it down explicitly first.
    backend_state.stop();
    app.restart();
}

/// Run one updater check/download/stage cycle immediately instead of waiting
/// for the next background interval, and report the resulting status. Used by
/// flows that need an update staged right now (e.g. the "Cline Hub was
/// updated" prompt), where restarting without a staged update would just
/// relaunch the same version.
#[tauri::command]
async fn check_for_update_now(
    app: tauri::AppHandle,
    update_state: State<'_, Arc<UpdateState>>,
) -> Result<UpdateStatus, String> {
    check_and_install_update(&app, update_state.inner()).await;
    Ok(update_state.snapshot())
}

/// Icon ids accepted by `set_app_icon`; kept in sync with APP_ICONS in
/// webview/lib/app-icon.ts. Every non-default id has a matching bundled
/// resource at icons/dock/<id>.png.
const APP_DOCK_ICONS: [&str; 4] = ["classic", "midnight", "hologram", "chip"];

#[tauri::command]
fn set_app_icon(app: tauri::AppHandle, icon: String) -> Result<bool, String> {
    if !APP_DOCK_ICONS.contains(&icon.as_str()) {
        return Err(format!("unknown app icon: {icon}"));
    }
    #[cfg(target_os = "macos")]
    {
        // "classic" also ships as a dock resource, so every choice loads the
        // same way; setApplicationIconImage's binding warns that passing nil
        // to restore the bundled icon may not be allowed.
        let icon_path = app
            .path()
            .resolve(
                format!("icons/dock/{icon}.png"),
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| format!("failed resolving dock icon resource: {e}"))?;
        if !icon_path.exists() {
            return Err(format!(
                "dock icon resource missing: {}",
                icon_path.display()
            ));
        }
        app.run_on_main_thread(move || {
            use objc2::{AllocAnyThread, MainThreadMarker};
            use objc2_app_kit::{NSApplication, NSImage};
            use objc2_foundation::NSString;

            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let ns_app = NSApplication::sharedApplication(mtm);
            let Some(image) = NSImage::initWithContentsOfFile(
                NSImage::alloc(),
                &NSString::from_str(&icon_path.to_string_lossy()),
            ) else {
                eprintln!("[dock-icon] failed loading image: {}", icon_path.display());
                return;
            };
            // SAFETY: called on the main thread with a valid, non-nil image.
            unsafe { ns_app.setApplicationIconImage(Some(&image)) };
        })
        .map_err(|e| format!("failed switching dock icon: {e}"))?;
        Ok(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(false)
    }
}

#[tauri::command]
fn open_mcp_settings_file() -> Result<String, String> {
    let settings_path = resolve_mcp_settings_path()?;
    if !settings_path.exists() {
        if let Some(parent) = settings_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed creating MCP settings directory: {e}"))?;
        }
        let initial = serde_json::json!({
            "mcpServers": {}
        });
        let mut body = serde_json::to_vec_pretty(&initial)
            .map_err(|e| format!("failed encoding MCP settings: {e}"))?;
        body.push(b'\n');
        fs::write(&settings_path, body)
            .map_err(|e| format!("failed writing MCP settings file: {e}"))?;
    }
    open_path_with_default_app(&settings_path)?;
    Ok(settings_path.to_string_lossy().to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn queue_desktop_action(app: &tauri::AppHandle, action: DesktopAction) {
    show_main_window(app);
    app.state::<DesktopActionState>().enqueue(action);
    if let Err(error) = app.emit_to(MAIN_WINDOW_LABEL, DESKTOP_ACTION_PENDING_EVENT, ()) {
        // The action remains queued and will be picked up by the webview's
        // initial drain after its event listener is registered.
        eprintln!("[desktop] failed to signal pending action: {error}");
    }
}

fn notification_response_opens_session(response: &notify_rust::NotificationResponse) -> bool {
    matches!(
        response,
        notify_rust::NotificationResponse::Default | notify_rust::NotificationResponse::Action(_)
    )
}

#[tauri::command]
fn show_session_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    session_id: String,
    sound: Option<String>,
) -> Result<(), String> {
    let title = title.trim();
    let body = body.trim();
    let session_id = session_id.trim();
    if title.is_empty() || body.is_empty() || session_id.is_empty() {
        return Err("notification title, body, and session ID are required".to_string());
    }

    let mut notification = notify_rust::Notification::new();
    notification
        .summary(title)
        .body(body)
        .auto_icon()
        .action("open-session", "Open");
    if let Some(sound) = sound
        .as_deref()
        .map(str::trim)
        .filter(|sound| !sound.is_empty())
    {
        notification.sound_name(sound);
    }

    #[cfg(target_os = "windows")]
    {
        use std::path::MAIN_SEPARATOR as SEP;

        let executable = tauri::utils::platform::current_exe()
            .map_err(|error| format!("failed resolving the app executable: {error}"))?;
        let executable_directory = executable
            .parent()
            .ok_or_else(|| "the app executable has no parent directory".to_string())?
            .display()
            .to_string();
        if !(executable_directory.ends_with(format!("{SEP}target{SEP}debug").as_str())
            || executable_directory.ends_with(format!("{SEP}target{SEP}release").as_str()))
        {
            notification.app_id(&app.config().identifier);
        }
    }

    #[cfg(target_os = "macos")]
    macos_notification::configure(&app)?;

    // The Tauri plugin provides permission and platform registration, but its
    // desktop send command drops the native response handle. Retain that handle
    // here so activating the banner can deep-route to the originating session.
    let handle = notification
        .show()
        .map_err(|error| format!("failed showing notification: {error}"))?;
    let app_handle = app.clone();
    let session_id = session_id.to_string();
    thread::spawn(move || {
        if let Err(error) =
            handle.wait_for_response(move |response: &notify_rust::NotificationResponse| {
                if notification_response_opens_session(response) {
                    queue_desktop_action(&app_handle, DesktopAction::OpenSession { session_id });
                }
            })
        {
            eprintln!("[notification] failed waiting for a notification response: {error}");
        }
    });

    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn application_menu_action(menu_id: &str) -> Option<DesktopAction> {
    match menu_id {
        VIEW_ZOOM_IN_MENU_ID => Some(DesktopAction::ZoomIn),
        VIEW_ZOOM_OUT_MENU_ID => Some(DesktopAction::ZoomOut),
        VIEW_ZOOM_RESET_MENU_ID => Some(DesktopAction::ZoomReset),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn setup_application_menu(app: &tauri::App) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    let zoom_in = MenuItem::with_id(app, VIEW_ZOOM_IN_MENU_ID, "Zoom In", true, None::<&str>)?;
    let zoom_out = MenuItem::with_id(
        app,
        VIEW_ZOOM_OUT_MENU_ID,
        "Zoom Out",
        true,
        Some("CmdOrCtrl+-"),
    )?;
    let zoom_reset = MenuItem::with_id(
        app,
        VIEW_ZOOM_RESET_MENU_ID,
        "Actual Size",
        true,
        Some("CmdOrCtrl+0"),
    )?;
    let separator = PredefinedMenuItem::separator(app)?;

    let mut view_menu = None;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            if submenu.text()? == "View" {
                view_menu = Some(submenu);
                break;
            }
        }
    }

    if let Some(view_menu) = view_menu {
        view_menu.prepend_items(&[&zoom_in, &zoom_out, &zoom_reset, &separator])?;
    } else {
        let view_menu =
            Submenu::with_items(app, "View", true, &[&zoom_in, &zoom_out, &zoom_reset])?;
        menu.append(&view_menu)?;
    }

    app.set_menu(menu)?;
    set_macos_menu_key_equivalent("View", "Zoom In", "+")?;
    app.on_menu_event(|app, event| {
        if let Some(action) = application_menu_action(event.id().as_ref()) {
            queue_desktop_action(app, action);
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_macos_menu_key_equivalent(
    menu_title: &str,
    item_title: &str,
    key_equivalent: &str,
) -> tauri::Result<()> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSEventModifierFlags};
    use objc2_foundation::NSString;

    let missing = |description: &str| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("native menu item not found: {description}"),
        )
    };
    let mtm = MainThreadMarker::new()
        .ok_or_else(|| std::io::Error::other("native menu setup must run on the main thread"))?;
    let app = NSApplication::sharedApplication(mtm);
    let main_menu = app.mainMenu().ok_or_else(|| missing("main menu"))?;
    let menu_item = main_menu
        .itemWithTitle(&NSString::from_str(menu_title))
        .ok_or_else(|| missing(menu_title))?;
    let submenu = menu_item
        .submenu()
        .ok_or_else(|| missing(&format!("{menu_title} submenu")))?;
    let item = submenu
        .itemWithTitle(&NSString::from_str(item_title))
        .ok_or_else(|| missing(item_title))?;

    // Tauri 2.11's accelerator parser cannot represent the `+` character.
    // Set the AppKit key equivalent directly so the menu displays and handles ⌘+.
    item.setKeyEquivalent(&NSString::from_str(key_equivalent));
    item.setKeyEquivalentModifierMask(NSEventModifierFlags::Command);
    Ok(())
}

fn setup_tray_icon(app: &tauri::App) -> tauri::Result<()> {
    let status = MenuItem::new(app, "Status: Healthy", false, None::<&str>)?;
    let running_sessions = MenuItem::new(app, running_sessions_text(0), false, None::<&str>)?;
    let menu = MenuBuilder::new(app)
        .text(
            TRAY_OPEN_MENU_ID,
            // package_info().name is the configured productName, so beta
            // builds ("Cline Beta") identify themselves in the tray too.
            format!(
                "{} v{}",
                app.package_info().name,
                app.package_info().version
            ),
        )
        .item(&status)
        .separator()
        .text(TRAY_NEW_SESSION_MENU_ID, "New Session")
        .item(&running_sessions)
        .separator()
        .text(TRAY_SETTINGS_MENU_ID, "Settings")
        .separator()
        .text(TRAY_QUIT_MENU_ID, "Quit")
        .build()?;

    // This is the same glyph used by webview/components/cline-logo.tsx,
    // rasterized without a background. Template mode lets macOS tint it for
    // the current menu-bar appearance.
    #[cfg(target_os = "macos")]
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray/cline-template.png"))?;
    #[cfg(not(target_os = "macos"))]
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::InvalidIcon(std::io::Error::other("missing app icon")))?;

    let tray = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip(tray_tooltip_text(app.package_info().name.as_str(), 0));
    #[cfg(target_os = "macos")]
    let tray = tray.icon_as_template(true);

    tray.on_menu_event(|app, event| match event.id().as_ref() {
        TRAY_OPEN_MENU_ID => show_main_window(app),
        TRAY_NEW_SESSION_MENU_ID => queue_desktop_action(app, DesktopAction::NewSession),
        TRAY_SETTINGS_MENU_ID => queue_desktop_action(app, DesktopAction::OpenSettings),
        TRAY_QUIT_MENU_ID => app.exit(0),
        _ => {}
    })
    .build(app)?;
    app.manage(TrayMenuState {
        status,
        hub_healthy: Mutex::new(true),
        running_sessions,
    });
    Ok(())
}

#[tauri::command]
fn drain_desktop_actions(action_state: State<'_, DesktopActionState>) -> Vec<DesktopAction> {
    action_state.drain()
}

#[tauri::command]
fn set_tray_status(
    app: tauri::AppHandle,
    tray_menu: State<'_, TrayMenuState>,
    update_state: State<'_, Arc<UpdateState>>,
    hub_healthy: bool,
    running_sessions: u32,
) -> Result<(), String> {
    if let Ok(mut healthy) = tray_menu.hub_healthy.lock() {
        *healthy = hub_healthy;
    }
    tray_menu
        .status
        .set_text(tray_status_text(&update_state.snapshot(), hub_healthy))
        .map_err(|error| format!("failed updating tray status: {error}"))?;
    tray_menu
        .running_sessions
        .set_text(running_sessions_text(running_sessions))
        .map_err(|error| format!("failed updating tray session count: {error}"))?;
    if let Some(tray) = app.tray_by_id(TRAY_ICON_ID) {
        tray.set_tooltip(Some(tray_tooltip_text(
            app.package_info().name.as_str(),
            running_sessions,
        )))
            .map_err(|error| format!("failed updating tray tooltip: {error}"))?;
        tray.set_title(tray_badge_text(running_sessions))
            .map_err(|error| format!("failed updating tray badge: {error}"))?;
    }
    Ok(())
}

fn main() {
    let desktop_backend = Arc::new(DesktopBackendState::default());
    let launch_cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());
    let workspace_root = resolve_workspace_root(&launch_cwd);
    let app_context = AppContext {
        launch_cwd,
        workspace_root,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(desktop_backend)
        .manage(app_context)
        .manage(Arc::new(UpdateState::default()))
        .manage(DesktopActionState::default())
        .setup(|app| {
            if tauri::is_dev() {
                if let (Some(window), Some(product_name)) = (
                    app.get_webview_window(MAIN_WINDOW_LABEL),
                    app.config().product_name.as_deref(),
                ) {
                    window.set_title(product_name)?;
                }
            }
            #[cfg(target_os = "macos")]
            if let Err(error) = macos_notification::configure(app.handle()) {
                eprintln!("[notification] setup failed: {error}");
            }
            #[cfg(target_os = "macos")]
            setup_application_menu(app)?;
            setup_tray_icon(app)?;
            let app_context = app.state::<AppContext>().inner().clone();
            let backend_state = app.state::<Arc<DesktopBackendState>>().inner().clone();
            if let Err(error) = ensure_desktop_backend_started(&backend_state, &app_context) {
                eprintln!("[desktop-backend] startup failed: {error}");
            }
            // Dev builds are not installed app bundles, so there is nothing the
            // updater could meaningfully check or replace.
            if !cfg!(debug_assertions) {
                let update_state = app.state::<Arc<UpdateState>>().inner().clone();
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    run_update_loop(app_handle, update_state).await;
                });
            }
            thread::spawn(move || loop {
                thread::sleep(Duration::from_secs(5));
                if backend_state.is_shutting_down() {
                    break;
                }
                if let Err(error) = ensure_desktop_backend_started(&backend_state, &app_context) {
                    eprintln!("[desktop-backend] health check failed: {error}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_backend_endpoint,
            pick_workspace_directory,
            open_mcp_settings_file,
            get_update_status,
            restart_to_apply_update,
            check_for_update_now,
            set_app_icon,
            show_session_notification,
            drain_desktop_actions,
            set_tray_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri app")
        .run(|app_handle, event| match event {
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => show_main_window(app_handle),
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                app_handle
                    .state::<Arc<DesktopBackendState>>()
                    .inner()
                    .stop();
            }
            _ => {}
        });
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn desktop_actions_are_buffered_in_order_until_drained() {
        let state = DesktopActionState::default();
        state.enqueue(DesktopAction::NewSession);
        state.enqueue(DesktopAction::OpenSession {
            session_id: "session-1".to_string(),
        });

        assert_eq!(
            state.drain(),
            vec![
                DesktopAction::NewSession,
                DesktopAction::OpenSession {
                    session_id: "session-1".to_string(),
                },
            ]
        );
        assert!(state.drain().is_empty());
    }

    #[test]
    fn desktop_session_actions_serialize_for_the_webview() {
        let action = DesktopAction::OpenSession {
            session_id: "session-1".to_string(),
        };

        assert_eq!(
            serde_json::to_value(action).unwrap(),
            serde_json::json!({
                "type": "open-session",
                "sessionId": "session-1",
            })
        );
    }

    #[test]
    fn only_notification_activation_opens_a_session() {
        assert!(notification_response_opens_session(
            &notify_rust::NotificationResponse::Default
        ));
        assert!(notification_response_opens_session(
            &notify_rust::NotificationResponse::Action("open-session".to_string())
        ));
        assert!(!notification_response_opens_session(
            &notify_rust::NotificationResponse::Closed(notify_rust::CloseReason::Dismissed)
        ));
    }

    #[test]
    fn application_menu_ids_map_to_zoom_actions() {
        assert_eq!(
            application_menu_action(VIEW_ZOOM_IN_MENU_ID),
            Some(DesktopAction::ZoomIn)
        );
        assert_eq!(
            application_menu_action(VIEW_ZOOM_OUT_MENU_ID),
            Some(DesktopAction::ZoomOut)
        );
        assert_eq!(
            application_menu_action(VIEW_ZOOM_RESET_MENU_ID),
            Some(DesktopAction::ZoomReset)
        );
        assert_eq!(application_menu_action("unknown"), None);
    }

    #[test]
    fn tray_status_prioritizes_update_progress_over_hub_health() {
        let status = |state: &str| UpdateStatus {
            state: state.to_string(),
            version: None,
            error: None,
        };

        assert_eq!(tray_status_text(&status("idle"), true), "Status: Healthy");
        assert_eq!(
            tray_status_text(&status("idle"), false),
            "Status: Hub Disconnected"
        );
        assert_eq!(
            tray_status_text(&status("checking"), false),
            "Status: Checking for Updates"
        );
        assert_eq!(
            tray_status_text(&status("downloading"), false),
            "Status: Downloading Update"
        );
        assert_eq!(
            tray_status_text(&status("ready"), false),
            "Status: Update Available"
        );
        assert_eq!(
            tray_status_text(&status("error"), false),
            "Status: Update Check Failed"
        );
    }

    #[test]
    fn tray_session_count_updates_menu_tooltip_and_badge_copy() {
        assert_eq!(running_sessions_text(0), "0 sessions running");
        assert_eq!(running_sessions_text(1), "1 session running");
        assert_eq!(running_sessions_text(3), "3 sessions running");
        assert_eq!(tray_tooltip_text("Cline", 0), "Cline");
        assert_eq!(tray_tooltip_text("Cline", 3), "Cline — 3 sessions running");
        assert_eq!(
            tray_tooltip_text("Cline Beta", 2),
            "Cline Beta — 2 sessions running"
        );
        assert_eq!(tray_badge_text(0), None);
        assert_eq!(tray_badge_text(3), Some("3".to_string()));
    }

    /// A stand-in sidecar that stays alive without ever publishing a ready
    /// line — the endpoint-pending startup window that used to trigger
    /// duplicate spawns.
    fn spawn_pending_sidecar() -> Result<Child, String> {
        Command::new("sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())
    }

    #[test]
    fn repeated_startup_checks_reuse_live_child_while_endpoint_pending() {
        let state = Arc::new(DesktopBackendState::default());
        let spawn_count = AtomicUsize::new(0);
        for _ in 0..3 {
            ensure_desktop_backend_started_with(&state, || {
                spawn_count.fetch_add(1, Ordering::SeqCst);
                spawn_pending_sidecar()
            })
            .expect("startup check should succeed");
        }
        assert_eq!(spawn_count.load(Ordering::SeqCst), 1);
        // Kill the fake sidecar directly so stop() doesn't wait out its
        // graceful-exit window.
        if let Ok(mut guard) = state.process.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        state.stop();
    }

    #[test]
    fn concurrent_startup_checks_spawn_exactly_one_child() {
        let state = Arc::new(DesktopBackendState::default());
        let spawn_count = Arc::new(AtomicUsize::new(0));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let state = state.clone();
                let spawn_count = spawn_count.clone();
                thread::spawn(move || {
                    ensure_desktop_backend_started_with(&state, || {
                        spawn_count.fetch_add(1, Ordering::SeqCst);
                        spawn_pending_sidecar()
                    })
                    .expect("startup check should succeed");
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("startup thread should not panic");
        }
        assert_eq!(spawn_count.load(Ordering::SeqCst), 1);
        if let Ok(mut guard) = state.process.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        state.stop();
    }

    #[test]
    fn exited_child_is_replaced_on_next_startup_check() {
        let state = Arc::new(DesktopBackendState::default());
        let spawn_count = AtomicUsize::new(0);
        let spawn_exiting = || {
            spawn_count.fetch_add(1, Ordering::SeqCst);
            Command::new("true")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())
        };
        ensure_desktop_backend_started_with(&state, || spawn_exiting())
            .expect("startup check should succeed");
        // Wait for the first child to exit so the next check sees a dead one.
        for _ in 0..100 {
            let exited = state
                .process
                .lock()
                .ok()
                .map(|mut guard| match guard.as_mut() {
                    Some(child) => !matches!(child.try_wait(), Ok(None)),
                    None => true,
                })
                .unwrap_or(false);
            if exited {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        ensure_desktop_backend_started_with(&state, || spawn_exiting())
            .expect("startup check should succeed");
        assert_eq!(spawn_count.load(Ordering::SeqCst), 2);
        state.stop();
    }
}
