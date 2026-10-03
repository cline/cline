//! Native sidecar lifecycle, endpoint readiness, retries, and bounded diagnostics.
use crate::{hide_console_window, AppContext};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

/// Lock order: `process` may be held while acquiring `ws_endpoint`, never
/// the reverse. Anything that touches both (including stop()) must either
/// nest in that order or take them strictly sequentially.
#[derive(Default)]
pub(crate) struct DesktopBackendState {
    ws_endpoint: Mutex<Option<String>>,
    process: Mutex<Option<Child>>,
    shutting_down: AtomicBool,
    diagnostics: Mutex<BackendDiagnostics>,
    retry: Mutex<()>,
}

const MAX_STARTUP_DIAGNOSTICS: usize = 32;
const MAX_DIAGNOSTIC_LINE: usize = 1024;

#[derive(Default)]
struct BackendDiagnostics {
    started_at: Option<Instant>,
    lines: VecDeque<String>,
    exit_status: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopBackendStatus {
    state: &'static str,
    diagnostics: Vec<String>,
    exit_status: Option<String>,
    error: Option<String>,
}

// Do not retain potentially sensitive log records at all. This intentionally
// trades detail for safety: OAuth URLs, headers, settings dumps and endpoint
// authentication tokens must never be replayed to the webview.
fn sanitize_startup_diagnostic(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    static MARKERS: OnceLock<Vec<String>> = OnceLock::new();
    let markers = MARKERS.get_or_init(|| {
        serde_json::from_str(include_str!("../../shared/startup-diagnostic-markers.json"))
            .expect("startup diagnostic markers must be a valid JSON string array")
    });
    if markers.iter().any(|marker| lower.contains(marker)) {
        return "[Sensitive startup diagnostic omitted]".to_string();
    }
    line.chars()
        .filter(|c| !c.is_control())
        .take(MAX_DIAGNOSTIC_LINE)
        .collect()
}

// Forward only sanitized output, and keep draining the pipe if the log sink fails.
fn forward_backend_diagnostic(mut output: impl Write, stream: &str, line: &str) {
    let _ = writeln!(output, "[{stream}] {}", sanitize_startup_diagnostic(line));
}

// Bound memory even when a failing process writes a huge unterminated line.
fn read_diagnostic_lines(reader: impl std::io::Read, mut consume: impl FnMut(String)) {
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    let mut truncated = false;
    loop {
        let Ok(buffer) = reader.fill_buf() else { break };
        if buffer.is_empty() {
            if !line.is_empty() {
                consume(if truncated {
                    "[Oversized startup diagnostic omitted]".to_string()
                } else {
                    String::from_utf8_lossy(&line).into_owned()
                });
            }
            break;
        }
        let length = buffer
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|i| i + 1)
            .unwrap_or(buffer.len());
        let complete = buffer[length - 1] == b'\n';
        let available = MAX_DIAGNOSTIC_LINE.saturating_sub(line.len());
        if length > available {
            truncated = true;
        }
        line.extend_from_slice(&buffer[..length.min(available)]);
        reader.consume(length);
        if complete {
            // A truncated record could hide a sensitive marker after its prefix.
            consume(if truncated {
                "[Oversized startup diagnostic omitted]".to_string()
            } else {
                String::from_utf8_lossy(&line).into_owned()
            });
            line.clear();
            truncated = false;
        }
    }
}

impl DesktopBackendState {
    fn record_diagnostic(&self, line: &str) {
        if self
            .ws_endpoint
            .lock()
            .map(|endpoint| endpoint.is_some())
            .unwrap_or(false)
        {
            return;
        }
        let line = sanitize_startup_diagnostic(line.trim());
        if line.is_empty() {
            return;
        }
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            if diagnostics.lines.len() == MAX_STARTUP_DIAGNOSTICS {
                diagnostics.lines.pop_front();
            }
            diagnostics.lines.push_back(line);
        }
    }

    fn startup_failure(&self) -> String {
        let diagnostics = self
            .diagnostics
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut message = diagnostics.error.clone().unwrap_or_else(|| {
            "Desktop backend did not publish its endpoint. Retry startup.".to_string()
        });
        if let Some(status) = &diagnostics.exit_status {
            message.push_str(&format!(" Last sidecar exit: {status}."));
        }
        if !diagnostics.lines.is_empty() {
            message.push_str(&format!(
                " Startup diagnostics: {}",
                diagnostics
                    .lines
                    .iter()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" | ")
            ));
        }
        message
    }

    pub(crate) fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(AtomicOrdering::Acquire)
    }

    pub(crate) fn stop(&self) {
        self.shutting_down.store(true, AtomicOrdering::Release);

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
                // Windows has no SIGTERM equivalent, so terminate outright.
                // Reap the child too: TerminateProcess is quick, and the
                // update-restart path needs the sidecar exe's file lock
                // released before the NSIS installer replaces it.
                #[cfg(not(unix))]
                {
                    let _ = child.kill();
                    let _ = child.wait();
                }
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
        .stderr(Stdio::piped());
    hide_console_window(&mut command);
    command
        .spawn()
        .map_err(|e| format!("failed to start desktop backend sidecar: {e}"))
}

pub(crate) fn ensure_desktop_backend_started(
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
    let process_guard = state
        .process
        .lock()
        .map_err(|_| "failed to lock desktop backend process state")?;
    ensure_desktop_backend_started_locked(state, process_guard, spawn_backend)
}

/// The check-and-spawn that runs under the process lock. Split from the lock
/// acquisition so a test can establish "shutdown began after the unlocked
/// check but before the lock was taken" deterministically.
fn ensure_desktop_backend_started_locked(
    state: &Arc<DesktopBackendState>,
    mut process_guard: MutexGuard<'_, Option<Child>>,
    spawn_backend: impl FnOnce() -> Result<Child, String>,
) -> Result<(), String> {
    // stop() marks shutdown before taking this same process lock. Recheck
    // under the lock so a queued startup cannot spawn after shutdown.
    if state.is_shutting_down() {
        return Ok(());
    }
    if let Some(existing) = process_guard.as_mut() {
        match existing.try_wait() {
            // A live child owns startup even while its endpoint is still
            // pending (login-shell PATH resolution can take a few seconds). Spawning again here would orphan it and
            // race on the port.
            Ok(None) => return Ok(()),
            outcome => {
                if let Ok(mut diagnostics) = state.diagnostics.lock() {
                    diagnostics.exit_status = Some(match outcome {
                        Ok(Some(status)) => status.to_string(),
                        Err(error) => sanitize_startup_diagnostic(&error.to_string()),
                        _ => unreachable!(),
                    });
                }
                *process_guard = None;
                if let Ok(mut endpoint_guard) = state.ws_endpoint.lock() {
                    *endpoint_guard = None;
                }
            }
        }
    }

    if let Ok(mut diagnostics) = state.diagnostics.lock() {
        if let Some(previous_exit) = diagnostics.exit_status.take() {
            if diagnostics.lines.len() == MAX_STARTUP_DIAGNOSTICS {
                diagnostics.lines.pop_front();
            }
            diagnostics
                .lines
                .push_back(format!("Previous sidecar exited: {previous_exit}"));
        }
        diagnostics.error = None;
        diagnostics.started_at = Some(Instant::now());
    }
    let mut child = spawn_backend().map_err(|error| {
        let error = sanitize_startup_diagnostic(&error);
        if let Ok(mut diagnostics) = state.diagnostics.lock() {
            diagnostics.error = Some(error.clone());
        }
        error
    })?;

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
        read_diagnostic_lines(stdout, |line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return;
            }
            if let Ok(parsed) = serde_json::from_str::<DesktopBackendReadyLine>(trimmed) {
                if parsed.line_type == "ready" {
                    if let Some(endpoint) = parsed.ws_endpoint.or(parsed.endpoint) {
                        // A replaced child may still flush a buffered ready line.
                        let process = state_for_stdout
                            .process
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        if !state_for_stdout.is_shutting_down()
                            && process.as_ref().map(Child::id) == Some(child_pid)
                        {
                            if let Ok(mut endpoint_guard) = state_for_stdout.ws_endpoint.lock() {
                                *endpoint_guard = Some(endpoint);
                            }
                            if let Ok(mut diagnostics) = state_for_stdout.diagnostics.lock() {
                                diagnostics.error = None;
                            }
                        }
                    }
                    return;
                }
            }
            forward_backend_diagnostic(std::io::stderr(), "desktop-backend", trimmed);
            state_for_stdout.record_diagnostic(trimmed);
        });
        // Only clear the endpoint if this thread's child is still the one
        // being tracked — a late EOF from a replaced child must not wipe the
        // endpoint its successor already published.
        if let Ok(process) = state_for_stdout.process.lock() {
            if process.as_ref().map(Child::id) == Some(child_pid) {
                if let Ok(mut endpoint_guard) = state_for_stdout.ws_endpoint.lock() {
                    *endpoint_guard = None;
                }
            }
        }
    });

    let state_for_stderr = state.clone();
    thread::spawn(move || {
        read_diagnostic_lines(stderr, |line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return;
            }
            forward_backend_diagnostic(std::io::stderr(), "desktop-backend:err", trimmed);
            state_for_stderr.record_diagnostic(trimmed);
        });
    });

    *process_guard = Some(child);
    Ok(())
}

/// How long one `get_desktop_backend_endpoint` call waits for the sidecar's
/// ready line. Sidecar startup includes login-shell PATH resolution (bounded
/// at ~7.5s worst case, see sdk/packages/core/src/remote/shell-path.ts).
/// Hub initialization runs independently after endpoint publication. A first
/// spawn that dies is respawned inside the wait — the window must cover a
/// failed first start plus a full second startup. The wait returns as soon as
/// the ready line arrives, so only failure waits long, and the webview keeps
/// re-requesting the endpoint after a failure anyway.
const ENDPOINT_WAIT_TIMEOUT: Duration = Duration::from_secs(30);
const ENDPOINT_WAIT_POLL_INTERVAL: Duration = Duration::from_millis(100);
/// Minimum spacing between respawn attempts inside one endpoint wait, so a
/// crash-looping sidecar is not relaunched on every poll tick.
const ENDPOINT_RESPAWN_BACKOFF: Duration = Duration::from_secs(2);

/// Wait until the tracked sidecar publishes its WebSocket endpoint.
///
/// A live child owns startup — this only waits on it. A child that dies
/// before publishing is respawned here (paced by `respawn_backoff`) instead
/// of failing the wait: recovery used to be left to the 5s health-check loop
/// plus a webview retry, which made the first sign-in fail whenever the
/// sidecar's first spawn lost a startup race (cline/cline#14201, #14129).
/// Runs on the blocking pool; `respawn` may take the process lock and spawn.
fn wait_for_desktop_backend_endpoint(
    state: &Arc<DesktopBackendState>,
    total_wait: Duration,
    poll_interval: Duration,
    respawn_backoff: Duration,
    mut respawn: impl FnMut() -> Result<(), String>,
) -> Result<String, String> {
    let deadline = Instant::now() + total_wait;
    let mut last_respawn: Option<Instant> = None;
    loop {
        if state.is_shutting_down() {
            return Err("desktop backend is shutting down".to_string());
        }
        if let Some(endpoint) = state
            .ws_endpoint
            .lock()
            .ok()
            .and_then(|value| value.as_ref().cloned())
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(endpoint);
        }
        let child_exited = state
            .process
            .lock()
            .ok()
            .map(|mut guard| match guard.as_mut() {
                Some(child) => !matches!(child.try_wait(), Ok(None)),
                None => true,
            })
            .unwrap_or(false);
        if child_exited
            && last_respawn
                .map(|at| at.elapsed() >= respawn_backoff)
                .unwrap_or(true)
        {
            last_respawn = Some(Instant::now());
            // A spawn error (sidecar binary missing) is permanent for this
            // wait; report it instead of burning the rest of the window.
            respawn()?;
        }
        if Instant::now() >= deadline {
            let message = state.startup_failure();
            if let Ok(mut diagnostics) = state.diagnostics.lock() {
                if diagnostics.error.is_none() {
                    diagnostics.error = Some(
                        "Desktop backend did not publish its endpoint. Retry startup.".to_string(),
                    );
                }
            }
            return Err(message);
        }
        thread::sleep(poll_interval);
    }
}

#[tauri::command]
pub(crate) fn get_desktop_backend_status(
    backend_state: State<'_, Arc<DesktopBackendState>>,
) -> DesktopBackendStatus {
    desktop_backend_status(&backend_state)
}

fn desktop_backend_status(backend_state: &DesktopBackendState) -> DesktopBackendStatus {
    // Reap an exited child before inspecting endpoint readiness. The stdout
    // reader and periodic supervisor can otherwise lag behind the process.
    if let Ok(mut process) = backend_state.process.lock() {
        if let Some(child) = process.as_mut() {
            if let Ok(Some(status)) = child.try_wait() {
                if let Ok(mut endpoint) = backend_state.ws_endpoint.lock() {
                    *endpoint = None;
                }
                if let Ok(mut diagnostics) = backend_state.diagnostics.lock() {
                    diagnostics.exit_status = Some(status.to_string());
                }
            }
        }
    }
    let ready = backend_state
        .ws_endpoint
        .lock()
        .map(|endpoint| endpoint.is_some())
        .unwrap_or(false);
    let mut diagnostics = backend_state
        .diagnostics
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !ready
        && diagnostics.error.is_none()
        && diagnostics
            .started_at
            .is_some_and(|started| started.elapsed() >= ENDPOINT_WAIT_TIMEOUT)
    {
        diagnostics.error = Some(
            "Desktop backend did not publish its endpoint within 30 seconds. Retry startup."
                .to_string(),
        );
    }
    // Status reads never wait for readiness; the webview can render immediately.
    let state = if ready {
        "ready"
    } else if diagnostics.error.is_some() || diagnostics.exit_status.is_some() {
        "failed"
    } else {
        "starting"
    };
    DesktopBackendStatus {
        state,
        diagnostics: diagnostics.lines.iter().cloned().collect(),
        exit_status: diagnostics.exit_status.clone(),
        error: diagnostics.error.clone(),
    }
}

fn retry_desktop_backend_with(
    state: &Arc<DesktopBackendState>,
    spawn_backend: impl FnOnce() -> Result<Child, String>,
) -> Result<(), String> {
    let Ok(_retry) = state.retry.try_lock() else {
        return Ok(());
    };
    let mut process = state
        .process
        .lock()
        .map_err(|_| "failed to lock desktop backend process state")?;
    if state.is_shutting_down() {
        return Err("desktop backend is shutting down".to_string());
    }
    if state
        .ws_endpoint
        .lock()
        .map(|endpoint| endpoint.is_some())
        .unwrap_or(false)
    {
        return Ok(());
    }
    // Repeated clicks after the first retry must reuse its pending child.
    let failed = state
        .diagnostics
        .lock()
        .map(|diagnostics| diagnostics.error.is_some() || diagnostics.exit_status.is_some())
        .unwrap_or(false);
    if !failed && process.is_some() {
        return Ok(());
    }
    if let Some(child) = process.as_mut() {
        child
            .kill()
            .map_err(|error| format!("failed to stop desktop backend: {error}"))?;
        child
            .wait()
            .map_err(|error| format!("failed to reap desktop backend: {error}"))?;
    }
    *process = None;
    if let Ok(mut diagnostics) = state.diagnostics.lock() {
        *diagnostics = BackendDiagnostics::default();
    }
    ensure_desktop_backend_started_locked(state, process, spawn_backend)
}

#[tauri::command]
pub(crate) async fn retry_desktop_backend(
    backend_state: State<'_, Arc<DesktopBackendState>>,
    context: State<'_, AppContext>,
) -> Result<(), String> {
    let state = backend_state.inner().clone();
    let context = context.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        retry_desktop_backend_with(&state, || spawn_desktop_backend_process(&context))
    })
    .await
    .map_err(|error| format!("desktop backend retry task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn get_desktop_backend_endpoint(
    backend_state: State<'_, Arc<DesktopBackendState>>,
    context: State<'_, AppContext>,
) -> Result<String, String> {
    let backend_state = backend_state.inner().clone();
    let context = context.inner().clone();
    // The whole wait runs on the blocking pool: it sleeps, takes the process
    // lock, and may spawn a replacement sidecar, and Tauri's async runtime
    // (window events, other commands) must stay responsive meanwhile.
    tauri::async_runtime::spawn_blocking(move || {
        ensure_desktop_backend_started(&backend_state, &context)?;
        wait_for_desktop_backend_endpoint(
            &backend_state,
            ENDPOINT_WAIT_TIMEOUT,
            ENDPOINT_WAIT_POLL_INTERVAL,
            ENDPOINT_RESPAWN_BACKOFF,
            || ensure_desktop_backend_started(&backend_state, &context),
        )
    })
    .await
    .map_err(|error| format!("desktop backend startup task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn startup_diagnostics_are_bounded_and_sanitized() {
        let state = DesktopBackendState::default();
        for index in 0..100 {
            state.record_diagnostic(&format!("startup failure {index}"));
        }
        state.record_diagnostic("Authorization: Bearer private-value");
        state.record_diagnostic("ws://127.0.0.1/transport?approval_token=private-value");
        state.record_diagnostic("api_key = private-value");
        let diagnostics = state.diagnostics.lock().unwrap();
        assert_eq!(diagnostics.lines.len(), MAX_STARTUP_DIAGNOSTICS);
        assert!(diagnostics
            .lines
            .iter()
            .all(|line| !line.contains("private-value")));
        assert!(diagnostics
            .lines
            .iter()
            .any(|line| line.contains("startup failure 99")));
    }

    #[test]
    fn forwarded_output_is_sanitized_and_broken_sinks_do_not_interrupt_readers() {
        for stream in ["desktop-backend", "desktop-backend:err"] {
            let mut output = Vec::new();
            forward_backend_diagnostic(&mut output, stream, "Error: missing dependency");
            forward_backend_diagnostic(&mut output, stream, "https://user:private-value@host/path");
            forward_backend_diagnostic(&mut output, stream, "approval_token=private-value");
            let text = String::from_utf8(output).unwrap();
            assert!(text.contains("missing dependency"));
            assert!(!text.contains("private-value"));
            assert!(text.contains("Sensitive startup diagnostic omitted"));
        }
        struct BrokenSink;
        impl Write for BrokenSink {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "closed",
                ))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        forward_backend_diagnostic(BrokenSink, "desktop-backend", "still draining");
    }

    #[test]
    fn oversized_diagnostic_records_are_discarded_including_unterminated_records() {
        for suffix in ["", "\n"] {
            let input = format!(
                "{}secret=hidden{}",
                "a".repeat(MAX_DIAGNOSTIC_LINE * 2),
                suffix
            );
            let mut lines = Vec::new();
            read_diagnostic_lines(input.as_bytes(), |line| lines.push(line));
            assert_eq!(lines, ["[Oversized startup diagnostic omitted]"]);
        }
    }

    #[test]
    fn startup_failure_includes_exit_status_and_sanitized_diagnostics() {
        let state = DesktopBackendState::default();
        state.record_diagnostic("Error: failed to load sidecar module");
        state.record_diagnostic("token=private-value");
        state.diagnostics.lock().unwrap().exit_status = Some("exit status: 7".to_string());
        let error = state.startup_failure();
        assert!(error.contains("exit status: 7"));
        assert!(error.contains("failed to load sidecar module"));
        assert!(!error.contains("private-value"));
    }

    #[test]
    fn crashed_sidecar_retains_stderr_and_exit_status_across_respawn() {
        let state = Arc::new(DesktopBackendState::default());
        ensure_desktop_backend_started_with(&state, || {
            Command::new("sh").arg("-c")
                .arg("echo 'Error: missing sidecar dependency' >&2; echo 'approval_token=private-value' >&2; exit 7")
                .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|error| error.to_string())
        }).unwrap();
        wait_until_tracked_child_exits(&state);
        let deadline = Instant::now() + Duration::from_secs(2);
        while state.diagnostics.lock().unwrap().lines.len() < 2 {
            assert!(Instant::now() < deadline, "stderr should be captured");
            thread::sleep(Duration::from_millis(5));
        }
        ensure_desktop_backend_started_with(&state, spawn_pending_sidecar).unwrap();
        let status = desktop_backend_status(&state);
        assert_eq!(status.state, "starting");
        assert!(status.exit_status.is_none());
        let error = state.startup_failure();
        assert!(error.contains("exit status: 7"));
        assert!(error.contains("missing sidecar dependency"));
        assert!(!error.contains("private-value"));
        state
            .process
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .kill()
            .unwrap();
        state.stop();
    }

    #[test]
    fn status_times_out_pending_startup_without_an_endpoint_request_and_retry_resets_timer() {
        let state = Arc::new(DesktopBackendState::default());
        ensure_desktop_backend_started_with(&state, spawn_pending_sidecar).unwrap();
        assert_eq!(desktop_backend_status(&state).state, "starting");
        state.diagnostics.lock().unwrap().started_at = Some(Instant::now() - ENDPOINT_WAIT_TIMEOUT);
        let status = desktop_backend_status(&state);
        assert_eq!(status.state, "failed");
        assert!(status.error.unwrap().contains("Retry startup"));
        retry_desktop_backend_with(&state, spawn_pending_sidecar).unwrap();
        let status = desktop_backend_status(&state);
        assert_eq!(status.state, "starting");
        assert!(status.error.is_none());
        assert!(
            state
                .diagnostics
                .lock()
                .unwrap()
                .started_at
                .unwrap()
                .elapsed()
                < ENDPOINT_WAIT_TIMEOUT
        );
        // Once transport is ready, elapsed startup time cannot fail it.
        *state.ws_endpoint.lock().unwrap() = Some("ws://127.0.0.1/transport".to_string());
        state.diagnostics.lock().unwrap().started_at = Some(Instant::now() - ENDPOINT_WAIT_TIMEOUT);
        assert_eq!(desktop_backend_status(&state).state, "ready");
        state
            .process
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .kill()
            .unwrap();
        state.stop();
    }

    #[test]
    fn repeated_retry_replaces_failed_child_once_and_respects_shutdown() {
        let state = Arc::new(DesktopBackendState::default());
        ensure_desktop_backend_started_with(&state, spawn_pending_sidecar).unwrap();
        let original = state.process.lock().unwrap().as_ref().unwrap().id();
        state.diagnostics.lock().unwrap().error = Some("startup timed out".to_string());
        let attempts = AtomicUsize::new(0);
        for _ in 0..3 {
            retry_desktop_backend_with(&state, || {
                attempts.fetch_add(1, Ordering::SeqCst);
                spawn_pending_sidecar()
            })
            .unwrap();
        }
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        let replacement = state.process.lock().unwrap().as_ref().unwrap().id();
        assert_ne!(original, replacement);
        assert!(state.diagnostics.lock().unwrap().error.is_none());
        state.shutting_down.store(true, AtomicOrdering::Release);
        assert!(retry_desktop_backend_with(&state, || panic!("shutdown must not spawn")).is_err());
        state
            .process
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .kill()
            .unwrap();
        state.stop();
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

    /// The interleaving where only the recheck under the lock stands between
    /// shutdown and a fresh spawn: startup has passed its unlocked shutdown
    /// check, stop() marks shutdown while startup is still waiting for the
    /// process lock, and then startup acquires the lock. Played out directly
    /// on one thread so the ordering is exact rather than scheduled.
    #[test]
    fn startup_queued_on_process_lock_does_not_spawn_after_shutdown() {
        let state = Arc::new(DesktopBackendState::default());
        let spawn_count = AtomicUsize::new(0);

        assert!(!state.is_shutting_down(), "the unlocked check passes");
        state.shutting_down.store(true, AtomicOrdering::Release);
        let process_guard = state.process.lock().expect("process lock should succeed");
        ensure_desktop_backend_started_locked(&state, process_guard, || {
            spawn_count.fetch_add(1, Ordering::SeqCst);
            spawn_pending_sidecar()
        })
        .expect("shutdown should make startup a no-op");

        assert_eq!(spawn_count.load(Ordering::SeqCst), 0);
    }

    /// A stand-in sidecar that publishes a ready line like the real one and
    /// then stays alive.
    fn spawn_ready_sidecar(endpoint: &str) -> Result<Child, String> {
        Command::new("sh")
            .arg("-c")
            .arg(format!(
                "printf '%s\\n' '{{\"type\":\"ready\",\"wsEndpoint\":\"{endpoint}\"}}'; sleep 30"
            ))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())
    }

    /// A stand-in sidecar that exits immediately without publishing —
    /// the "first spawn lost a startup race" failure from issue #14129.
    fn spawn_exiting_sidecar() -> Result<Child, String> {
        Command::new("true")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())
    }

    fn wait_until_tracked_child_exits(state: &Arc<DesktopBackendState>) {
        for _ in 0..200 {
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
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("tracked child did not exit in time");
    }

    #[test]
    fn endpoint_wait_returns_the_endpoint_published_by_a_live_child() {
        let state = Arc::new(DesktopBackendState::default());
        ensure_desktop_backend_started_with(&state, || {
            spawn_ready_sidecar("ws://127.0.0.1:3126/transport?approval_token=t")
        })
        .expect("startup should succeed");

        let endpoint = wait_for_desktop_backend_endpoint(
            &state,
            Duration::from_secs(10),
            Duration::from_millis(10),
            Duration::from_millis(100),
            || panic!("a live child must not be respawned"),
        )
        .expect("endpoint should become ready");
        assert_eq!(endpoint, "ws://127.0.0.1:3126/transport?approval_token=t");

        if let Ok(mut guard) = state.process.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        state.stop();
    }

    /// The launch race from issues #14201/#14129: the first sidecar exits
    /// before publishing its endpoint. The wait must respawn it and keep
    /// waiting for the replacement's ready line instead of failing the
    /// webview's endpoint request.
    #[test]
    fn endpoint_wait_respawns_a_dead_child_and_returns_its_successor_endpoint() {
        let state = Arc::new(DesktopBackendState::default());
        ensure_desktop_backend_started_with(&state, spawn_exiting_sidecar)
            .expect("startup should succeed");
        wait_until_tracked_child_exits(&state);

        let respawn_count = AtomicUsize::new(0);
        let endpoint = wait_for_desktop_backend_endpoint(
            &state,
            Duration::from_secs(10),
            Duration::from_millis(10),
            Duration::from_millis(50),
            || {
                respawn_count.fetch_add(1, Ordering::SeqCst);
                ensure_desktop_backend_started_with(&state, || {
                    spawn_ready_sidecar("ws://127.0.0.1:3126/transport?approval_token=respawned")
                })
            },
        )
        .expect("endpoint should become ready after the respawn");
        assert_eq!(
            endpoint,
            "ws://127.0.0.1:3126/transport?approval_token=respawned"
        );
        assert!(respawn_count.load(Ordering::SeqCst) >= 1);

        if let Ok(mut guard) = state.process.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        state.stop();
    }

    #[test]
    fn endpoint_wait_paces_respawns_of_a_crash_looping_child() {
        let state = Arc::new(DesktopBackendState::default());
        ensure_desktop_backend_started_with(&state, spawn_exiting_sidecar)
            .expect("startup should succeed");
        wait_until_tracked_child_exits(&state);

        let respawn_count = AtomicUsize::new(0);
        let result = wait_for_desktop_backend_endpoint(
            &state,
            Duration::from_millis(400),
            Duration::from_millis(10),
            Duration::from_millis(150),
            || {
                respawn_count.fetch_add(1, Ordering::SeqCst);
                ensure_desktop_backend_started_with(&state, spawn_exiting_sidecar)
            },
        );
        assert!(result.unwrap_err().contains("did not publish its endpoint"));
        // 400ms window with a 150ms backoff allows the initial respawn plus
        // at most a few paced ones — not one per 10ms poll tick.
        let respawns = respawn_count.load(Ordering::SeqCst);
        assert!(
            (1..=4).contains(&respawns),
            "expected paced respawns, got {respawns}"
        );
        state.stop();
    }

    #[test]
    fn endpoint_wait_times_out_while_the_child_stays_pending() {
        let state = Arc::new(DesktopBackendState::default());
        ensure_desktop_backend_started_with(&state, spawn_pending_sidecar)
            .expect("startup should succeed");

        let result = wait_for_desktop_backend_endpoint(
            &state,
            Duration::from_millis(200),
            Duration::from_millis(10),
            Duration::from_millis(100),
            || panic!("a live child must not be respawned"),
        );
        assert!(result.unwrap_err().contains("did not publish its endpoint"));

        if let Ok(mut guard) = state.process.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
        state.stop();
    }

    #[test]
    fn endpoint_wait_stops_when_shutdown_begins() {
        let state = Arc::new(DesktopBackendState::default());
        state.shutting_down.store(true, AtomicOrdering::Release);

        let result = wait_for_desktop_backend_endpoint(
            &state,
            Duration::from_secs(10),
            Duration::from_millis(10),
            Duration::from_millis(100),
            || panic!("shutdown must not respawn"),
        );
        assert_eq!(result, Err("desktop backend is shutting down".to_string()));
    }

    #[test]
    fn endpoint_wait_surfaces_a_permanent_respawn_failure() {
        let state = Arc::new(DesktopBackendState::default());
        ensure_desktop_backend_started_with(&state, spawn_exiting_sidecar)
            .expect("startup should succeed");
        wait_until_tracked_child_exits(&state);

        let result = wait_for_desktop_backend_endpoint(
            &state,
            Duration::from_secs(10),
            Duration::from_millis(10),
            Duration::from_millis(50),
            || Err("desktop backend sidecar not found".to_string()),
        );
        assert_eq!(result, Err("desktop backend sidecar not found".to_string()));
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
