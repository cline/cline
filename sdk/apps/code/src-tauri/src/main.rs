#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Manager, RunEvent, State};

#[derive(Clone)]
struct AppContext {
    launch_cwd: String,
    workspace_root: String,
}

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

        if let Ok(endpoint_guard) = self.ws_endpoint.lock() {
            if let Some(endpoint) = endpoint_guard.as_ref() {
                request_desktop_backend_shutdown(endpoint);
            }
        }

        if let Ok(mut process_guard) = self.process.lock() {
            if let Some(child) = process_guard.as_mut() {
                for _ in 0..30 {
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
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("code")
            .join("sidecar")
            .join("index.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("sidecar")
            .join("index.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("apps")
            .join("code")
            .join("sidecar")
            .join("index.ts"),
    ];
    candidates.into_iter().find(|path| path.exists())
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
    let candidates = [
        explicit,
        Some(
            PathBuf::from(&context.workspace_root)
                .join("apps")
                .join("code")
                .join("src-tauri")
                .join("bin")
                .join("code-sidecar"),
        ),
        current_exe
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.join("code-sidecar"))),
        current_exe.as_ref().and_then(|path| {
            path.parent()
                .and_then(|parent| parent.parent())
                .map(|parent| parent.join("Resources").join("code-sidecar"))
        }),
    ];
    candidates.into_iter().flatten().find(|path| path.exists())
}

fn ensure_desktop_backend_started(
    state: &Arc<DesktopBackendState>,
    context: &AppContext,
) -> Result<(), String> {
    if state.is_shutting_down() {
        return Ok(());
    }

    {
        let mut process_guard = state
            .process
            .lock()
            .map_err(|_| "failed to lock desktop backend process state")?;
        if let Some(existing) = process_guard.as_mut() {
            match existing.try_wait() {
                Ok(None) => {
                    if state
                        .ws_endpoint
                        .lock()
                        .ok()
                        .and_then(|value| value.as_ref().cloned())
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or(false)
                    {
                        return Ok(());
                    }
                }
                Ok(Some(_)) | Err(_) => {
                    *process_guard = None;
                    if let Ok(mut endpoint_guard) = state.ws_endpoint.lock() {
                        *endpoint_guard = None;
                    }
                }
            }
        }
    }

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

    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start desktop backend sidecar: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture desktop backend stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture desktop backend stderr".to_string())?;

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
        if let Ok(mut endpoint_guard) = state_for_stdout.ws_endpoint.lock() {
            *endpoint_guard = None;
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

    let mut process_guard = state
        .process
        .lock()
        .map_err(|_| "failed to lock desktop backend process state")?;
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
    for _ in 0..50 {
        if let Some(endpoint) = backend_state
            .ws_endpoint
            .lock()
            .ok()
            .and_then(|value| value.as_ref().cloned())
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(endpoint);
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
        .manage(desktop_backend)
        .manage(app_context)
        .setup(|app| {
            let app_context = app.state::<AppContext>().inner().clone();
            let backend_state = app.state::<Arc<DesktopBackendState>>().inner().clone();
            if let Err(error) = ensure_desktop_backend_started(&backend_state, &app_context) {
                eprintln!("[desktop-backend] startup failed: {error}");
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
        .invoke_handler(tauri::generate_handler![
            get_desktop_backend_endpoint,
            pick_workspace_directory,
            open_mcp_settings_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri app")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                app_handle
                    .state::<Arc<DesktopBackendState>>()
                    .inner()
                    .stop();
            }
            _ => {}
        });
}
