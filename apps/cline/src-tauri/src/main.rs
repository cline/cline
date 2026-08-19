#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
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
#[cfg(any(target_os = "macos", test))]
const VIEW_ZOOM_IN_MENU_ID: &str = "view-zoom-in";
#[cfg(any(target_os = "macos", test))]
const VIEW_ZOOM_OUT_MENU_ID: &str = "view-zoom-out";
#[cfg(any(target_os = "macos", test))]
const VIEW_ZOOM_RESET_MENU_ID: &str = "view-zoom-reset";
const DESKTOP_MENU_ACTION_PENDING_EVENT: &str = "desktop-menu-action-pending";

#[derive(Default)]
struct DesktopMenuActionState {
    pending: Mutex<VecDeque<String>>,
}

impl DesktopMenuActionState {
    fn enqueue(&self, action: &str) {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push_back(action.to_string());
    }

    fn drain(&self) -> Vec<String> {
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

/// One sandboxed (or, in the no-launcher fallback, unsandboxed) backend
/// process, scoped to exactly one `(bot_id, project_path)` pair. Its own
/// sandbox filesystem allowlist is fixed at spawn time to just this project
/// - see apps/cline/sandbox/launcher.ts - so a distinct `BackendEntry` per
/// project is what keeps one project's process from ever being handed
/// another project's path.
///
/// Lock order: `process` may be held while acquiring `ws_endpoint`, never
/// the reverse. Anything that touches both (including stop()) must either
/// nest in that order or take them strictly sequentially.
struct BackendEntry {
    bot_id: String,
    project_path: String,
    host_system_prompt: String,
    ws_endpoint: Mutex<Option<String>>,
    process: Mutex<Option<Child>>,
}

impl BackendEntry {
    fn new(bot_id: String, project_path: String, host_system_prompt: String) -> Self {
        Self {
            bot_id,
            project_path,
            host_system_prompt,
            ws_endpoint: Mutex::new(None),
            process: Mutex::new(None),
        }
    }

    fn stop(&self) {
        if let Ok(endpoint_guard) = self.ws_endpoint.lock() {
            if let Some(endpoint) = endpoint_guard.as_ref() {
                request_desktop_backend_shutdown(endpoint);
            }
        }

        if let Ok(mut process_guard) = self.process.lock() {
            if let Some(child) = process_guard.as_mut() {
                // The sidecar bounds its own graceful shutdown with
                // SHUTDOWN_TIMEOUT_MS (5s in sidecar/index.ts) and then exits
                // itself; wait past that window before escalating to kill so
                // an active session can finish persisting.
                for _ in 0..70 {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        Ok(None) => thread::sleep(Duration::from_millis(100)),
                        Err(_) => break,
                    }
                }
                match child.try_wait() {
                    Ok(Some(_)) => {}
                    Ok(None) => {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    Err(_) => {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
            *process_guard = None;
        }

        if let Ok(mut endpoint_guard) = self.ws_endpoint.lock() {
            *endpoint_guard = None;
        }
    }
}

/// A pool of `BackendEntry` values, keyed by `(bot_id, project_path)`. An
/// entry is created the first time a project is requested (via
/// `get_desktop_backend_endpoint`) - never eagerly, and never for a project
/// that hasn't gone through `assign_project` - so a project the user hasn't
/// opened for this bot has no entry, no process, and no filesystem access,
/// full stop.
#[derive(Default)]
struct DesktopBackendState {
    entries: Mutex<HashMap<String, Arc<BackendEntry>>>,
    shutting_down: Mutex<bool>,
}

impl DesktopBackendState {
    fn is_shutting_down(&self) -> bool {
        self.shutting_down
            .lock()
            .map(|guard| *guard)
            .unwrap_or(true)
    }

    fn entry_key(bot_id: &str, project_path: &str) -> String {
        format!("{bot_id}:{project_path}")
    }

    /// Returns the entry for `(bot_id, project_path)`, creating an empty one
    /// (no process yet) the first time it's requested this run.
    fn entry_for(
        &self,
        bot_id: &str,
        project_path: &str,
        host_system_prompt: &str,
    ) -> Arc<BackendEntry> {
        let key = Self::entry_key(bot_id, project_path);
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        entries
            .entry(key)
            .or_insert_with(|| {
                Arc::new(BackendEntry::new(
                    bot_id.to_string(),
                    project_path.to_string(),
                    host_system_prompt.to_string(),
                ))
            })
            .clone()
    }

    /// Every entry that has been requested so far this run. Used only for
    /// self-healing already-running processes (the periodic check) and for
    /// full teardown - never for deciding what to spawn next.
    fn snapshot_entries(&self) -> Vec<Arc<BackendEntry>> {
        self.entries
            .lock()
            .map(|guard| guard.values().cloned().collect())
            .unwrap_or_default()
    }

    fn stop_all(&self) {
        if let Ok(mut guard) = self.shutting_down.lock() {
            *guard = true;
        }
        for entry in self.snapshot_entries() {
            entry.stop();
        }
    }
}

impl Drop for DesktopBackendState {
    fn drop(&mut self) {
        self.stop_all();
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

fn request_desktop_backend_shutdown(endpoint: &str) {
    let trimmed = endpoint.trim();
    if trimmed.is_empty() {
        return;
    }
    let base = trimmed.strip_suffix('/').unwrap_or(trimmed);
    let url = format!("{base}/shutdown");
    let timeout_seconds = "2";

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "try {{ Invoke-WebRequest -UseBasicParsing -Method Post -Uri '{}' -TimeoutSec {} | Out-Null }} catch {{ }}",
                    url.replace('\'', "''"),
                    timeout_seconds
                ),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("curl")
            .args([
                "-fsS",
                "--connect-timeout",
                timeout_seconds,
                "--max-time",
                timeout_seconds,
                "-X",
                "POST",
                &url,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
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
    let bundled_name = format!("cline-sidecar{extension}");
    let target_triple = option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or("").trim();
    if target_triple.is_empty() {
        return vec![bundled_name];
    }

    vec![
        bundled_name,
        format!("cline-sidecar-{target_triple}{extension}"),
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
                .join("cline")
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

/// Unlike `resolve_desktop_backend_binary_path`, this checks regardless of
/// debug/release: the sandboxed launcher needs a real compiled binary to
/// wrap (wrapping `bun run sidecar/index.ts` would need much broader
/// filesystem read access to the whole source tree, defeating most of the
/// isolation - see SANDBOX.md). In dev builds this requires having run
/// `bun run build:sidecar:bin` at least once.
fn resolve_compiled_sidecar_binary_for_sandbox(context: &AppContext) -> Option<PathBuf> {
    for binary_name in desktop_backend_binary_names() {
        let candidate = PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("cline")
            .join("src-tauri")
            .join("bin")
            .join(&binary_name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// The sandbox launcher is TypeScript source, not something bundled into the
/// compiled app yet - see SANDBOX.md's open gaps. Only found in a dev
/// checkout, which is the only place this has been exercised so far.
fn resolve_sandbox_launcher_path(context: &AppContext) -> Option<PathBuf> {
    let candidate = PathBuf::from(&context.workspace_root)
        .join("apps")
        .join("cline")
        .join("sandbox")
        .join("launcher.ts");
    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

/// Sandboxed by default whenever both a compiled sidecar binary and the
/// launcher script are available - the launcher itself decides at runtime
/// whether the OS actually supports sandboxing (falling back to running the
/// binary unsandboxed rather than failing to start at all - see
/// sandbox/launcher.ts). `context.workspace_root`/`context.launch_cwd` are
/// used only to *locate the app's own installed files* (the compiled
/// binary, the launcher script) - an unsandboxed, host-side lookup concern,
/// separate from `project_path`, which is what actually gets mounted into
/// the sandbox and is never implicitly the monorepo checkout or any other
/// directory the caller didn't explicitly pass in.
///
/// `project_path` may be empty - that's the "no project" entry, scoped to
/// only the bot's own data (provider settings, onboarding state), used
/// before the user has assigned any project yet. The launcher already
/// treats a falsy workspace-dir argument as "no workspace to allow" (see
/// sandbox/launcher.ts), so passing `""` naturally grants nothing beyond
/// the bot's own tree; `current_dir` is left unset in that case rather than
/// pointed at an empty path.
fn spawn_desktop_backend_process(
    context: &AppContext,
    bot_id: &str,
    project_path: &str,
    host_system_prompt: &str,
) -> Result<Child, String> {
    if let (Some(binary_path), Some(launcher_path)) = (
        resolve_compiled_sidecar_binary_for_sandbox(context),
        resolve_sandbox_launcher_path(context),
    ) {
        let mut command = Command::new("bun");
        command
            .arg("run")
            .arg(&launcher_path)
            .arg(&binary_path)
            .arg(project_path)
            .env("CLINE_BOT_ID", bot_id)
            .env("CLINE_HOST_SYSTEM_PROMPT", host_system_prompt)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if !project_path.is_empty() {
            command.current_dir(project_path);
        }
        return command
            .spawn()
            .map_err(|e| format!("failed to start sandboxed desktop backend: {e}"));
    }

    // Fallback: no compiled binary/launcher found, so this runs unsandboxed
    // (see resolve_compiled_sidecar_binary_for_sandbox's own doc comment).
    // CLINE_BOT_ID is set for interface consistency, but nothing enforces
    // per-project isolation on this path - it's a dev/production-without-
    // launcher escape hatch, not the security-relevant path.
    let mut command = if let Some(binary_path) = resolve_desktop_backend_binary_path(context) {
        Command::new(binary_path)
    } else if let Some(script_path) = resolve_desktop_backend_script_path(context) {
        let mut command = Command::new("bun");
        command
            .arg("run")
            .arg(script_path.to_string_lossy().to_string());
        command
    } else {
        return Err(format!(
            "desktop backend sidecar not found. checked binary/script under workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };
    if !project_path.is_empty() {
        command.current_dir(project_path);
    }

    command
        .env("CLINE_BOT_ID", bot_id)
        .env("CLINE_HOST_SYSTEM_PROMPT", host_system_prompt)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start desktop backend sidecar: {e}"))
}

fn ensure_backend_entry_started(
    state: &Arc<DesktopBackendState>,
    context: &AppContext,
    entry: &Arc<BackendEntry>,
) -> Result<(), String> {
    let entry_for_spawn = entry.clone();
    ensure_backend_entry_started_with(state, entry, || {
        spawn_desktop_backend_process(
            context,
            &entry_for_spawn.bot_id,
            &entry_for_spawn.project_path,
            &entry_for_spawn.host_system_prompt,
        )
    })
}

fn ensure_backend_entry_started_with(
    state: &Arc<DesktopBackendState>,
    entry: &Arc<BackendEntry>,
    spawn_backend: impl FnOnce() -> Result<Child, String>,
) -> Result<(), String> {
    if state.is_shutting_down() {
        return Ok(());
    }

    // Hold the process lock for the entire check-and-spawn so concurrent
    // callers (the health-check loop, endpoint fetches from the webview) for
    // the *same project* serialize: the second caller blocks here, then sees
    // the live child and returns instead of spawning a duplicate. Different
    // projects have different entries and different locks, so they proceed
    // independently.
    let mut process_guard = entry
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
                if let Ok(mut endpoint_guard) = entry.ws_endpoint.lock() {
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
    let entry_for_stdout = entry.clone();
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
                        if let Ok(mut endpoint_guard) = entry_for_stdout.ws_endpoint.lock() {
                            *endpoint_guard = Some(endpoint);
                        }
                    }
                    continue;
                }
            }
            eprintln!(
                "[desktop-backend:{}] {trimmed}",
                entry_for_stdout.project_path
            );
        }
        // Only clear the endpoint if this thread's child is still the one
        // being tracked — a late EOF from a replaced child must not wipe the
        // endpoint its successor already published.
        let owns_tracked_child = entry_for_stdout
            .process
            .lock()
            .ok()
            .map(|guard| guard.as_ref().map(|child| child.id()) == Some(child_pid))
            .unwrap_or(false);
        if owns_tracked_child {
            if let Ok(mut endpoint_guard) = entry_for_stdout.ws_endpoint.lock() {
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

/// A bot's assigned-projects registry: the list of directories this bot
/// identity has ever been explicitly given access to. Owned and mutated
/// **only** by this trusted, unsandboxed host process, in Tauri's own
/// app-data directory - deliberately never inside `~/.cline/bots/<bot-id>/`,
/// which the bot's own sandboxed process has `allowWrite` on. If the
/// registry lived there, a compromised agent could grant itself access to
/// arbitrary future paths just by editing its own registry file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ProjectRegistry {
    projects: Vec<String>,
}

fn sanitize_bot_id_for_path(bot_id: &str) -> String {
    let trimmed = bot_id.trim();
    if trimmed.is_empty() {
        return "cline".to_string();
    }
    trimmed
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn resolve_project_registry_path(app: &tauri::AppHandle, bot_id: &str) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data directory: {e}"))?;
    Ok(app_data_dir
        .join("bots")
        .join(sanitize_bot_id_for_path(bot_id))
        .join("projects.json"))
}

fn read_project_registry(path: &Path) -> ProjectRegistry {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_project_registry(path: &Path, registry: &ProjectRegistry) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create project registry directory: {e}"))?;
    }
    let serialized = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("failed to serialize project registry: {e}"))?;
    fs::write(path, serialized).map_err(|e| format!("failed to write project registry: {e}"))
}

/// Lists only the projects this bot has previously been assigned - never
/// derived from session history, browser storage, or anything else that
/// could reflect access the bot doesn't actually have.
#[tauri::command]
fn list_assigned_projects(app: tauri::AppHandle, bot_id: String) -> Result<Vec<String>, String> {
    let registry_path = resolve_project_registry_path(&app, &bot_id)?;
    Ok(read_project_registry(&registry_path).projects)
}

/// Expands a leading `~` (or `~/...`) to the real home directory, mirroring
/// shell tilde expansion. `fs::canonicalize` has no concept of it, so a
/// user- or agent-supplied path like `~/recipes` would otherwise resolve
/// against the literal current directory (looking for a folder actually
/// named `~`) and fail with a confusing "No such file or directory" even
/// when the intended real folder exists.
fn expand_home_tilde(path: &str) -> String {
    if path == "~" {
        return std::env::var("HOME").unwrap_or_else(|_| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

/// Grants a bot access to a new project directory. `path` should come from
/// an explicit user action (the native folder picker, or a manually typed
/// path the user confirmed) - this is the one moment access is actually
/// established, so it validates unsandboxed (a brand-new path can't yet be
/// checked through any running sandboxed process, since by definition no
/// process has it mounted) and persists to the registry before anything is
/// spawned.
#[tauri::command]
fn assign_project(app: tauri::AppHandle, bot_id: String, path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("project path is required".to_string());
    }
    let expanded = expand_home_tilde(trimmed);
    let resolved =
        fs::canonicalize(&expanded).map_err(|e| format!("could not resolve project path: {e}"))?;
    if !resolved.is_dir() {
        return Err("selected path is not a directory".to_string());
    }
    let resolved_string = resolved.to_string_lossy().to_string();

    let registry_path = resolve_project_registry_path(&app, &bot_id)?;
    let mut registry = read_project_registry(&registry_path);
    if !registry
        .projects
        .iter()
        .any(|existing| existing == &resolved_string)
    {
        registry.projects.push(resolved_string.clone());
        write_project_registry(&registry_path, &registry)?;
    }
    Ok(resolved_string)
}

const MAX_BOTS: usize = 5;
// Matches sandbox/bot-config.ts's DEFAULT_BOT_ID - kept in sync manually,
// since that's TypeScript and this is Rust, exactly like CLINE_BOT_ID
// threading elsewhere in this file already has to be.
const DEFAULT_BOT_ID: &str = "cline";
const DEFAULT_BOT_NAME: &str = "Cline";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BotSummary {
    id: String,
    name: String,
    /// Local filesystem path or URL to the bot's icon. Optional, and omitted
    /// from serialized output entirely when unset rather than written as
    /// `null`, so existing registry.json files without this field round-trip
    /// unchanged for bots that never set one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
}

/// The top-level registry of every bot identity that exists, plus which one
/// is active - one level up from `ProjectRegistry` (which lists one bot's
/// projects). Lives at `<app_data_dir>/bots/registry.json`, a sibling of the
/// per-bot `bots/<bot-id>/projects.json` files, for the identical reason
/// those live outside `~/.cline/bots/<bot-id>/`: the list of which bots
/// exist is host-owned, so a compromised sandboxed agent process can't
/// self-grant a new identity by writing into its own tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BotRegistryState {
    bots: Vec<BotSummary>,
    active_bot_id: String,
}

fn resolve_bot_registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data directory: {e}"))?;
    Ok(app_data_dir.join("bots").join("registry.json"))
}

fn read_bot_registry(path: &Path) -> BotRegistryState {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_bot_registry(path: &Path, registry: &BotRegistryState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create bot registry directory: {e}"))?;
    }
    let serialized = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("failed to serialize bot registry: {e}"))?;
    fs::write(path, serialized).map_err(|e| format!("failed to write bot registry: {e}"))
}

/// Never returns an empty bot list or an `active_bot_id` that doesn't match
/// any entry - callers never have to special-case "no bots yet". Pure (no
/// filesystem access) so it's unit-testable on its own.
fn seeded_bot_registry(mut registry: BotRegistryState) -> BotRegistryState {
    if registry.bots.is_empty() {
        registry.bots.push(BotSummary {
            id: DEFAULT_BOT_ID.to_string(),
            name: DEFAULT_BOT_NAME.to_string(),
            icon: None,
        });
    }
    if !registry
        .bots
        .iter()
        .any(|bot| bot.id == registry.active_bot_id)
    {
        registry.active_bot_id = registry.bots[0].id.clone();
    }
    registry
}

/// Read-modify-write-if-changed wrapper used by every command below, so the
/// on-disk file self-heals into a valid state - mirrors `ensureBotHomeReady`
/// (sandbox/bot-config.ts) being lazily idempotent on every launch - without
/// every caller re-implementing the write-back.
fn read_bot_registry_seeded(path: &Path) -> Result<BotRegistryState, String> {
    let raw = read_bot_registry(path);
    let seeded = seeded_bot_registry(raw.clone());
    if seeded != raw {
        write_bot_registry(path, &seeded)?;
    }
    Ok(seeded)
}

/// Derives a filesystem/URL-safe id from a user-typed bot display name:
/// lowercase, runs of anything that isn't `[a-z0-9]` collapse to a single
/// `-`, leading/trailing `-` trimmed. Falls back to `"bot"` if that leaves
/// nothing (e.g. a name that's all emoji/punctuation) - never returns an
/// empty id. Output is always a subset of what `sanitize_bot_id_for_path`
/// allows, so passing it through that function afterward (still done
/// wherever an id becomes a path segment) is always a no-op - the two
/// compose, they don't disagree.
fn slugify_bot_name(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "bot".to_string()
    } else {
        slug
    }
}

/// Appends "-2", "-3", ... until the id doesn't collide with an existing one.
fn dedupe_bot_id(base: &str, existing_ids: &[String]) -> String {
    if !existing_ids.iter().any(|id| id == base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if !existing_ids.iter().any(|id| id == &candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// One round trip: every bot that exists, plus which one is active.
#[tauri::command]
fn get_bots_state(app: tauri::AppHandle) -> Result<BotRegistryState, String> {
    let path = resolve_bot_registry_path(&app)?;
    read_bot_registry_seeded(&path)
}

/// The bot's own rules directory - bot-owned data living inside
/// `~/.cline/bots/<bot-id>/`, not the host-owned registries above. A bot's
/// own sandboxed process already has read/write access to this whole tree,
/// so writing here from the trusted host process needs no extra security
/// boundary beyond correct path handling (same reasoning as
/// `resolve_bot_chat_workspace_path` for the same tree).
const SYSTEM_PROMPT_FILE_NAME: &str = "system-prompt.md";

fn resolve_bot_system_prompt_path(bot_id: &str) -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".cline")
            .join("bots")
            .join(sanitize_bot_id_for_path(bot_id))
            .join("rules")
            .join(SYSTEM_PROMPT_FILE_NAME),
    )
}

fn render_bot_identity_prompt(bot: &BotSummary) -> String {
    let quoted_name = serde_json::to_string(&bot.name).unwrap_or_else(|_| "\"bot\"".to_string());
    let platform_distinction = if bot.id == DEFAULT_BOT_ID {
        String::new()
    } else {
        " Cline is the platform and base agent, not your display name.".to_string()
    };
    format!(
        "Your app-assigned name is {quoted_name}. If asked for your name or identity, answer with {quoted_name}.{platform_distinction}"
    )
}

/// Reads a bot's system prompt (see `write_bot_system_prompt`) - `None` if
/// one has never been set.
#[tauri::command]
fn read_bot_system_prompt(bot_id: String) -> Result<Option<String>, String> {
    let path = resolve_bot_system_prompt_path(&bot_id)
        .ok_or_else(|| "could not resolve home directory".to_string())?;
    match fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("failed to read system prompt: {e}")),
    }
}

/// Writes a bot's system prompt to its own `rules/system-prompt.md` - a
/// plain rules file, picked up automatically by the same mechanism that
/// loads every other rule into the running session's system prompt, so
/// there's no separate injection path to maintain.
#[tauri::command]
fn write_bot_system_prompt(bot_id: String, content: String) -> Result<(), String> {
    let path = resolve_bot_system_prompt_path(&bot_id)
        .ok_or_else(|| "could not resolve home directory".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create rules directory: {e}"))?;
    }
    fs::write(&path, content).map_err(|e| format!("failed to write system prompt: {e}"))
}

/// Creates a new bot identity. `initial_project_path`, if given, is granted
/// to the NEW bot's own project registry using `assign_project`'s own
/// validation (canonicalize + is_dir) - called directly, not reimplemented -
/// and that happens BEFORE the bot is added to the registry, so a bad path
/// fails the whole creation cleanly rather than leaving a half-created bot.
///
/// Unlike `assign_project`'s other callers (switching an *existing* bot's
/// workspace, where a nonexistent path is almost always a typo worth
/// rejecting), this path is often naming a folder that doesn't exist yet -
/// this is the one moment a bot is being set up for a brand-new purpose, and
/// callers like the agent-proposed bot-creation flow have no way to have
/// pre-created it first. So a missing directory is created here rather than
/// treated as an error, and only then handed to `assign_project` (which
/// still fails normally if, say, the path exists but isn't a directory).
///
/// `system_prompt`, if given, is written the same way, before the registry
/// push - same reasoning, a bad write shouldn't leave a half-created bot.
#[tauri::command]
fn create_bot(
    app: tauri::AppHandle,
    name: String,
    initial_project_path: Option<String>,
    icon: Option<String>,
    system_prompt: Option<String>,
) -> Result<BotSummary, String> {
    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("bot name is required".to_string());
    }

    let registry_path = resolve_bot_registry_path(&app)?;
    let mut registry = read_bot_registry_seeded(&registry_path)?;
    if registry.bots.len() >= MAX_BOTS {
        return Err(format!("maximum of {MAX_BOTS} bots reached"));
    }

    let existing_ids: Vec<String> = registry.bots.iter().map(|bot| bot.id.clone()).collect();
    let id = dedupe_bot_id(&slugify_bot_name(&trimmed_name), &existing_ids);

    if let Some(path) = initial_project_path.filter(|p| !p.trim().is_empty()) {
        let expanded = expand_home_tilde(path.trim());
        if !Path::new(&expanded).exists() {
            fs::create_dir_all(&expanded)
                .map_err(|e| format!("could not create project directory: {e}"))?;
        }
        assign_project(app.clone(), id.clone(), path)?;
    }

    if let Some(prompt) = system_prompt.filter(|p| !p.trim().is_empty()) {
        write_bot_system_prompt(id.clone(), prompt)?;
    }

    let summary = BotSummary {
        id,
        name: trimmed_name,
        icon: icon
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };
    registry.bots.push(summary.clone());
    write_bot_registry(&registry_path, &registry)?;
    Ok(summary)
}

/// Switches which bot is active. Pure persistence only - no process
/// spawning, no project logic - the webview sequences
/// `get_desktop_backend_endpoint`/UI updates separately once this succeeds.
#[tauri::command]
fn switch_active_bot(app: tauri::AppHandle, bot_id: String) -> Result<String, String> {
    let registry_path = resolve_bot_registry_path(&app)?;
    let mut registry = read_bot_registry_seeded(&registry_path)?;
    if !registry.bots.iter().any(|bot| bot.id == bot_id) {
        return Err(format!("unknown bot: {bot_id}"));
    }
    registry.active_bot_id = bot_id.clone();
    write_bot_registry(&registry_path, &registry)?;
    Ok(bot_id)
}

/// The SDK's own `isChatWorkspacePath` (sdk/packages/shared/src/storage/
/// chat-workspace-paths.ts) recognizes only the *default*, non-namespaced
/// layout (`.cline/data/workspaces/chat`) - its own doc comment says so
/// explicitly: "explicit CLINE_DATA_DIR overrides are not detectable from a
/// bare path string." Under our bot-namespacing, `CLINE_DIR` is always
/// `~/.cline/bots/<bot-id>/`, so the SDK's real, cascaded chat-workspace
/// path is `~/.cline/bots/<bot-id>/data/workspaces/chat` - one extra
/// `bots/<bot-id>` segment the SDK's generic structural check can't see.
/// Rather than adapt that heuristic, compute the exact path *this* bot's
/// session would get and compare directly - precise, and tied to our own
/// architecture instead of a borrowed, admittedly-incomplete pattern.
fn resolve_bot_chat_workspace_path(bot_id: &str) -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".cline")
            .join("bots")
            .join(sanitize_bot_id_for_path(bot_id))
            .join("data")
            .join("workspaces")
            .join("chat"),
    )
}

/// This bot's own `CLINE_DIR` (`~/.cline/bots/<bot-id>`) with no further
/// subpath - distinct from `resolve_bot_chat_workspace_path`'s nested
/// `data/workspaces/chat` scratch dir. Some sessions (e.g. ones started
/// while creating a *different* bot, before any project existed to assign)
/// end up with their stored cwd/workspaceRoot set to this bare directory
/// rather than the nested chat-workspace path. Recognizing it here too keeps
/// `get_desktop_backend_endpoint` from rejecting a session that was always
/// scoped to just the bot's own data - it's already covered by the bot's own
/// `allowRead`/`allowWrite` grant, same as the chat-workspace path is.
fn resolve_bot_home_dir_path(bot_id: &str) -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".cline")
            .join("bots")
            .join(sanitize_bot_id_for_path(bot_id)),
    )
}

/// `project_path` must be either empty (the "no project" entry, scoped to
/// only the bot's own data - used before any project has been assigned, for
/// provider settings/onboarding), this bot's own shared chat-workspace
/// scratch path (see `resolve_bot_chat_workspace_path` - the SDK
/// auto-assigns it to a session's cwd whenever no real project was
/// requested; it's not something a user picked via `assign_project`, but is
/// already fully covered by the bot's own `allowRead`/`allowWrite` grant on
/// its whole home directory), this bot's own bare home directory (see
/// `resolve_bot_home_dir_path` - some sessions store this instead of the
/// nested chat-workspace path, for the same "no real project" reason), or
/// already one of this bot's assigned projects - checked against the
/// host-owned registry before anything spawns, so a path that was never
/// explicitly granted (however it reached this command) is rejected rather
/// than quietly mounted.
#[tauri::command]
fn get_desktop_backend_endpoint(
    app: tauri::AppHandle,
    backend_state: State<'_, Arc<DesktopBackendState>>,
    context: State<'_, AppContext>,
    bot_id: String,
    project_path: String,
) -> Result<String, String> {
    let bot_registry_path = resolve_bot_registry_path(&app)?;
    let bot_registry = read_bot_registry_seeded(&bot_registry_path)?;
    let bot = bot_registry
        .bots
        .iter()
        .find(|bot| bot.id == bot_id)
        .ok_or_else(|| format!("unknown bot: {bot_id}"))?;
    let is_chat_workspace = resolve_bot_chat_workspace_path(&bot_id)
        .map(|chat_path| chat_path.to_string_lossy() == project_path)
        .unwrap_or(false)
        || resolve_bot_home_dir_path(&bot_id)
            .map(|home_path| home_path.to_string_lossy() == project_path)
            .unwrap_or(false);
    let project_path = if is_chat_workspace {
        String::new()
    } else {
        project_path
    };
    if !project_path.is_empty() {
        let registry_path = resolve_project_registry_path(&app, &bot_id)?;
        let registry = read_project_registry(&registry_path);
        if !registry
            .projects
            .iter()
            .any(|assigned| assigned == &project_path)
        {
            return Err(format!(
                "\"{project_path}\" has not been assigned to this bot yet — open it via the project picker first"
            ));
        }
    }

    let host_system_prompt = render_bot_identity_prompt(bot);
    let entry = backend_state
        .inner()
        .entry_for(&bot_id, &project_path, &host_system_prompt);
    // A brand-new project forces its own freshly-spawned Hub daemon (see
    // sandbox/launcher.ts's CLINE_HUB_DISCOVERY_PATH override) rather than
    // reusing an existing one - observed empirically to have an occasional
    // one-shot startup race (the connecting sidecar's first attempt can
    // lose to the daemon's own not-yet-finished bind/init, exiting almost
    // immediately with "Connection ended" instead of retrying internally).
    // Retrying the whole ensure-and-poll cycle a few times absorbs that;
    // an already-warm daemon (the common case) still resolves on the first
    // attempt.
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            thread::sleep(Duration::from_millis(300));
        }
        if let Err(error) =
            ensure_backend_entry_started(backend_state.inner(), context.inner(), &entry)
        {
            last_error = error;
            continue;
        }
        // Sidecar startup includes login-shell PATH resolution (bounded at 3s,
        // see sidecar/shell-path.ts) plus session-manager init, whose duration
        // varies by machine. Poll well past that combined worst case; the loop
        // returns as soon as the ready line arrives, so only failure waits long.
        // While pending this only waits — respawning is ensure's job, and it
        // refuses to start a second sidecar while the first one is still alive.
        let mut child_exited = false;
        for _ in 0..150 {
            if let Some(endpoint) = entry
                .ws_endpoint
                .lock()
                .ok()
                .and_then(|value| value.as_ref().cloned())
                .filter(|value| !value.trim().is_empty())
            {
                return Ok(endpoint);
            }
            child_exited = entry
                .process
                .lock()
                .ok()
                .map(|mut guard| match guard.as_mut() {
                    Some(child) => !matches!(child.try_wait(), Ok(None)),
                    None => true,
                })
                .unwrap_or(false);
            if child_exited {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        last_error = if child_exited {
            "desktop backend exited before publishing its endpoint".to_string()
        } else {
            "desktop backend endpoint not ready".to_string()
        };
    }
    Err(last_error)
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

/// Returns an absolute local path, never a URL - a bot's `icon` field also
/// accepts a plain URL, but that's typed in directly rather than picked via
/// this dialog.
#[tauri::command]
fn pick_bot_icon_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter(
            "Image",
            &["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"],
        )
        .pick_file()
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
    // chance to stop the sidecars; shut them all down explicitly first.
    backend_state.stop_all();
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
const APP_DOCK_ICONS: [&str; 4] = ["classic", "sunrise", "steel", "midnight"];

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

fn queue_desktop_menu_action(app: &tauri::AppHandle, action: &str) {
    show_main_window(app);
    app.state::<DesktopMenuActionState>().enqueue(action);
    if let Err(error) = app.emit_to(MAIN_WINDOW_LABEL, DESKTOP_MENU_ACTION_PENDING_EVENT, ()) {
        // The action remains queued and will be picked up by the webview's
        // initial drain after its event listener is registered.
        eprintln!("[desktop-menu] failed to signal pending {action}: {error}");
    }
}

#[cfg(any(target_os = "macos", test))]
fn application_menu_action(menu_id: &str) -> Option<&'static str> {
    match menu_id {
        VIEW_ZOOM_IN_MENU_ID => Some("zoom-in"),
        VIEW_ZOOM_OUT_MENU_ID => Some("zoom-out"),
        VIEW_ZOOM_RESET_MENU_ID => Some("zoom-reset"),
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
            queue_desktop_menu_action(app, action);
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
    let running_sessions = MenuItem::new(app, "0 sessions running", false, None::<&str>)?;
    let menu = MenuBuilder::new(app)
        .text(
            TRAY_OPEN_MENU_ID,
            format!("Cline v{}", app.package_info().version),
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
        .tooltip("Cline");
    #[cfg(target_os = "macos")]
    let tray = tray.icon_as_template(true);

    tray.on_menu_event(|app, event| match event.id().as_ref() {
        TRAY_OPEN_MENU_ID => show_main_window(app),
        TRAY_NEW_SESSION_MENU_ID => queue_desktop_menu_action(app, "new-session"),
        TRAY_SETTINGS_MENU_ID => queue_desktop_menu_action(app, "open-settings"),
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
fn drain_desktop_menu_actions(action_state: State<'_, DesktopMenuActionState>) -> Vec<String> {
    action_state.drain()
}

#[tauri::command]
fn set_tray_status(
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
        .set_text(match running_sessions {
            1 => "1 session running".to_string(),
            count => format!("{count} sessions running"),
        })
        .map_err(|error| format!("failed updating tray session count: {error}"))
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(desktop_backend)
        .manage(app_context)
        .manage(Arc::new(UpdateState::default()))
        .manage(DesktopMenuActionState::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            setup_application_menu(app)?;
            setup_tray_icon(app)?;
            let app_context = app.state::<AppContext>().inner().clone();
            let backend_state = app.state::<Arc<DesktopBackendState>>().inner().clone();
            // Unlike the old single-Hub model, nothing spawns here: no
            // project is mounted until the user selects one (via
            // get_desktop_backend_endpoint, gated on assign_project), so a
            // freshly launched app with no assigned projects runs zero
            // backend processes.
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
                // Self-heal only already-requested projects' processes;
                // never spawn one that hasn't gone through
                // get_desktop_backend_endpoint at least once.
                for entry in backend_state.snapshot_entries() {
                    if let Err(error) =
                        ensure_backend_entry_started(&backend_state, &app_context, &entry)
                    {
                        eprintln!(
                            "[desktop-backend:{}] health check failed: {error}",
                            entry.project_path
                        );
                    }
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
            list_assigned_projects,
            assign_project,
            get_bots_state,
            create_bot,
            switch_active_bot,
            read_bot_system_prompt,
            write_bot_system_prompt,
            pick_workspace_directory,
            pick_bot_icon_file,
            open_mcp_settings_file,
            get_update_status,
            restart_to_apply_update,
            check_for_update_now,
            set_app_icon,
            drain_desktop_menu_actions,
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
                    .stop_all();
            }
            _ => {}
        });
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn desktop_menu_actions_are_buffered_in_order_until_drained() {
        let state = DesktopMenuActionState::default();
        state.enqueue("new-session");
        state.enqueue("open-settings");

        assert_eq!(state.drain(), vec!["new-session", "open-settings"]);
        assert!(state.drain().is_empty());
    }

    #[test]
    fn application_menu_ids_map_to_zoom_actions() {
        assert_eq!(
            application_menu_action(VIEW_ZOOM_IN_MENU_ID),
            Some("zoom-in")
        );
        assert_eq!(
            application_menu_action(VIEW_ZOOM_OUT_MENU_ID),
            Some("zoom-out")
        );
        assert_eq!(
            application_menu_action(VIEW_ZOOM_RESET_MENU_ID),
            Some("zoom-reset")
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
        let entry = state.entry_for("test-bot", "/tmp/test-project", "test identity");
        let spawn_count = AtomicUsize::new(0);
        for _ in 0..3 {
            ensure_backend_entry_started_with(&state, &entry, || {
                spawn_count.fetch_add(1, Ordering::SeqCst);
                spawn_pending_sidecar()
            })
            .expect("startup check should succeed");
        }
        assert_eq!(spawn_count.load(Ordering::SeqCst), 1);
        // Kill the fake sidecar directly so stop() doesn't wait out its
        // graceful-exit window.
        if let Ok(mut guard) = entry.process.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        entry.stop();
    }

    #[test]
    fn concurrent_startup_checks_spawn_exactly_one_child() {
        let state = Arc::new(DesktopBackendState::default());
        let entry = state.entry_for("test-bot", "/tmp/test-project", "test identity");
        let spawn_count = Arc::new(AtomicUsize::new(0));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let state = state.clone();
                let entry = entry.clone();
                let spawn_count = spawn_count.clone();
                thread::spawn(move || {
                    ensure_backend_entry_started_with(&state, &entry, || {
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
        if let Ok(mut guard) = entry.process.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        entry.stop();
    }

    #[test]
    fn exited_child_is_replaced_on_next_startup_check() {
        let state = Arc::new(DesktopBackendState::default());
        let entry = state.entry_for("test-bot", "/tmp/test-project", "test identity");
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
        ensure_backend_entry_started_with(&state, &entry, || spawn_exiting())
            .expect("startup check should succeed");
        // Wait for the first child to exit so the next check sees a dead one.
        for _ in 0..100 {
            let exited = entry
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
        ensure_backend_entry_started_with(&state, &entry, || spawn_exiting())
            .expect("startup check should succeed");
        assert_eq!(spawn_count.load(Ordering::SeqCst), 2);
        entry.stop();
    }

    #[test]
    fn sanitize_bot_id_for_path_strips_traversal_characters() {
        assert_eq!(sanitize_bot_id_for_path("cline"), "cline");
        assert_eq!(sanitize_bot_id_for_path("../../etc"), "______etc");
        assert_eq!(sanitize_bot_id_for_path(""), "cline");
        assert_eq!(sanitize_bot_id_for_path("  "), "cline");
    }

    #[test]
    fn slugify_bot_name_derives_a_clean_slug() {
        assert_eq!(slugify_bot_name("Marketing Team!"), "marketing-team");
        assert_eq!(slugify_bot_name("  Research  "), "research");
        assert_eq!(slugify_bot_name(""), "bot");
        assert_eq!(slugify_bot_name("   "), "bot");
        assert_eq!(slugify_bot_name("!!!"), "bot");
        assert_eq!(slugify_bot_name("日本語"), "bot");
    }

    #[test]
    fn dedupe_bot_id_appends_a_numeric_suffix_on_collision() {
        let existing: Vec<String> = vec![];
        assert_eq!(dedupe_bot_id("research", &existing), "research");

        let existing = vec!["research".to_string()];
        assert_eq!(dedupe_bot_id("research", &existing), "research-2");

        let existing = vec!["research".to_string(), "research-2".to_string()];
        assert_eq!(dedupe_bot_id("research", &existing), "research-3");
    }

    #[test]
    fn seeded_bot_registry_never_returns_empty_or_dangling_active_id() {
        let seeded = seeded_bot_registry(BotRegistryState::default());
        assert_eq!(
            seeded.bots,
            vec![BotSummary {
                id: DEFAULT_BOT_ID.to_string(),
                name: DEFAULT_BOT_NAME.to_string(),
                icon: None,
            }]
        );
        assert_eq!(seeded.active_bot_id, DEFAULT_BOT_ID);

        let stale_active = BotRegistryState {
            bots: vec![BotSummary {
                id: "research".to_string(),
                name: "Research".to_string(),
                icon: None,
            }],
            active_bot_id: "does-not-exist".to_string(),
        };
        let corrected = seeded_bot_registry(stale_active);
        assert_eq!(corrected.active_bot_id, "research");

        let already_valid = BotRegistryState {
            bots: vec![BotSummary {
                id: "research".to_string(),
                name: "Research".to_string(),
                icon: None,
            }],
            active_bot_id: "research".to_string(),
        };
        assert_eq!(seeded_bot_registry(already_valid.clone()), already_valid);
    }

    #[test]
    fn resolve_bot_chat_workspace_path_matches_this_bots_own_scratch_dir_only() {
        let home = std::env::var("HOME").expect("HOME must be set to run this test");
        let expected = format!("{home}/.cline/bots/cline/data/workspaces/chat");
        let resolved = resolve_bot_chat_workspace_path("cline")
            .expect("HOME is set, so this should resolve")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        // A different bot's chat workspace is a different path entirely -
        // one bot's scratch dir must never validate against another's.
        let other_bot_resolved = resolve_bot_chat_workspace_path("marketing")
            .expect("HOME is set, so this should resolve")
            .to_string_lossy()
            .to_string();
        assert_ne!(resolved, other_bot_resolved);

        // A real project nested inside the chat workspace, or an unrelated
        // path, is not the scratch dir itself.
        assert_ne!(resolved, format!("{expected}/my-app"));
        assert_ne!(resolved, format!("{home}/projects/my-app"));
    }

    #[test]
    fn resolve_bot_home_dir_path_is_this_bots_bare_home_dir_only() {
        let home = std::env::var("HOME").expect("HOME must be set to run this test");
        let expected = format!("{home}/.cline/bots/cline");
        let resolved = resolve_bot_home_dir_path("cline")
            .expect("HOME is set, so this should resolve")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        // Distinct from the nested chat-workspace scratch path - both are
        // recognized as "no real project" in get_desktop_backend_endpoint,
        // but they are not the same path.
        let chat_workspace = resolve_bot_chat_workspace_path("cline")
            .expect("HOME is set, so this should resolve")
            .to_string_lossy()
            .to_string();
        assert_ne!(resolved, chat_workspace);

        // One bot's home dir must never validate against another's.
        let other_bot_resolved = resolve_bot_home_dir_path("marketing")
            .expect("HOME is set, so this should resolve")
            .to_string_lossy()
            .to_string();
        assert_ne!(resolved, other_bot_resolved);
    }

    #[test]
    fn resolve_bot_system_prompt_path_lives_in_this_bots_own_rules_dir() {
        let home = std::env::var("HOME").expect("HOME must be set to run this test");
        let expected = format!("{home}/.cline/bots/cline/rules/system-prompt.md");
        let resolved = resolve_bot_system_prompt_path("cline")
            .expect("HOME is set, so this should resolve")
            .to_string_lossy()
            .to_string();
        assert_eq!(resolved, expected);

        // One bot's system prompt must never resolve to another's path.
        let other_bot_resolved = resolve_bot_system_prompt_path("marketing")
            .expect("HOME is set, so this should resolve")
            .to_string_lossy()
            .to_string();
        assert_ne!(resolved, other_bot_resolved);
    }

    #[test]
    fn bot_identity_prompt_uses_the_registry_name_and_escapes_content() {
        let bot = BotSummary {
            id: "recipe-bot".to_string(),
            name: "Recipe \"Bot\"\nTrusted".to_string(),
            icon: None,
        };
        let prompt = render_bot_identity_prompt(&bot);
        assert!(prompt.contains(r#"Recipe \"Bot\"\nTrusted"#));
        assert!(!prompt.contains("Recipe \"Bot\"\nTrusted"));
        assert!(prompt.contains("Cline is the platform"));
    }

    #[test]
    fn expand_home_tilde_resolves_leading_tilde_only() {
        let home = std::env::var("HOME").expect("HOME must be set to run this test");
        assert_eq!(expand_home_tilde("~"), home);
        assert_eq!(expand_home_tilde("~/recipes"), format!("{home}/recipes"));
        // A bare absolute or relative path passes through unchanged.
        assert_eq!(expand_home_tilde("/tmp/recipes"), "/tmp/recipes");
        assert_eq!(expand_home_tilde("recipes"), "recipes");
        // Only a *leading* tilde is special - one elsewhere in the path is a
        // literal character, not shorthand for home.
        assert_eq!(expand_home_tilde("/tmp/~/recipes"), "/tmp/~/recipes");
    }
}
