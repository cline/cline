#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};

const TRAY_ID: &str = "main";

#[derive(Clone, Default, Serialize, Deserialize)]
struct HubState {
    connected: bool,
    last_workspace_root: Option<String>,
    hub_uptime: Option<String>,
    client_summaries: Vec<ClientSummary>,
    notifications: Vec<NotificationRecord>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientSummary {
    label: String,
    name: String,
    session_count: usize,
}

#[derive(Clone, Serialize, Deserialize)]
struct NotificationRecord {
    title: String,
    body: String,
    severity: String,
    timestamp: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarMessage {
    #[serde(rename = "type")]
    msg_type: String,
    ws_endpoint: Option<String>,
    endpoint: Option<String>,
    connected: Option<bool>,
    clients: Option<Vec<serde_json::Value>>,
    sessions: Option<Vec<serde_json::Value>>,
    client_summaries: Option<Vec<ClientSummary>>,
    last_workspace_root: Option<String>,
    hub_uptime: Option<String>,
    title: Option<String>,
    body: Option<String>,
    severity: Option<String>,
}

struct AppState {
    sidecar_process: Mutex<Option<Child>>,
    hub_state: Mutex<HubState>,
    last_hub_state_log: Mutex<Option<(bool, usize, usize)>>,
    ws_endpoint: Mutex<Option<String>>,
    app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl AppState {
    fn new() -> Self {
        AppState {
            sidecar_process: Mutex::new(None),
            hub_state: Mutex::new(HubState::default()),
            last_hub_state_log: Mutex::new(None),
            ws_endpoint: Mutex::new(None),
            app_handle: Mutex::new(None),
        }
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.sidecar_process.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn resolve_sidecar_script(workspace_root: &str, launch_cwd: &str) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(workspace_root)
            .join("apps")
            .join("menubar")
            .join("sidecar")
            .join("index.ts"),
        PathBuf::from(launch_cwd).join("sidecar").join("index.ts"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

fn resolve_sidecar_binary(workspace_root: &str) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    let current_exe = std::env::current_exe().ok();
    let candidates = [
        Some(
            PathBuf::from(workspace_root)
                .join("apps")
                .join("menubar")
                .join("src-tauri")
                .join("bin")
                .join("menubar-sidecar"),
        ),
        current_exe
            .as_ref()
            .and_then(|p| p.parent().map(|parent| parent.join("menubar-sidecar"))),
        current_exe.as_ref().and_then(|p| {
            p.parent()
                .and_then(|parent| parent.parent())
                .map(|parent| parent.join("Resources").join("menubar-sidecar"))
        }),
    ];
    candidates.into_iter().flatten().find(|p| p.exists())
}

fn start_sidecar(
    state: &Arc<AppState>,
    workspace_root: &str,
    launch_cwd: &str,
) -> Result<(), String> {
    {
        let mut guard = state.sidecar_process.lock().map_err(|_| "lock error")?;
        if let Some(child) = guard.as_mut() {
            if matches!(child.try_wait(), Ok(None)) {
                return Ok(());
            }
            *guard = None;
        }
    }

    let mut cmd = if let Some(bin) = resolve_sidecar_binary(workspace_root) {
        let mut c = Command::new(bin);
        c.current_dir(workspace_root);
        c
    } else if let Some(script) = resolve_sidecar_script(workspace_root, launch_cwd) {
        let mut c = Command::new("bun");
        c.arg("--conditions=development")
            .arg("run")
            .arg(script.to_string_lossy().to_string())
            .current_dir(workspace_root);
        c
    } else {
        return Err(format!(
            "menubar sidecar not found under workspace_root={workspace_root}"
        ));
    };

    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

    let stdout = child.stdout.take().ok_or("failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("failed to capture stderr")?;

    let state_for_stdout = state.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(msg) = serde_json::from_str::<SidecarMessage>(trimmed) {
                handle_sidecar_message(&state_for_stdout, msg, trimmed);
            } else {
                eprintln!("[menubar-sidecar] {trimmed}");
            }
        }
        if let Ok(mut ep) = state_for_stdout.ws_endpoint.lock() {
            *ep = None;
        }
    });

    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(text) = line {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    eprintln!("[menubar-sidecar:err] {trimmed}");
                }
            }
        }
    });

    let mut guard = state.sidecar_process.lock().map_err(|_| "lock error")?;
    *guard = Some(child);
    Ok(())
}

fn handle_sidecar_message(state: &Arc<AppState>, msg: SidecarMessage, raw: &str) {
    match msg.msg_type.as_str() {
        "ready" => {
            let url = msg.ws_endpoint.or(msg.endpoint);
            if let Some(url) = url {
                if let Ok(mut ep) = state.ws_endpoint.lock() {
                    *ep = Some(url.clone());
                }
                eprintln!("[menubar-sidecar] ready at {url}");
            }
            refresh_tray_menu(state);
        }
        "hub_state" => {
            let client_count = msg.clients.as_ref().map(|v| v.len()).unwrap_or(0);
            let session_count = msg.sessions.as_ref().map(|v| v.len()).unwrap_or(0);
            let connected = msg.connected.unwrap_or(false);
            if let Ok(mut hub) = state.hub_state.lock() {
                hub.connected = connected;
                hub.client_summaries = msg.client_summaries.unwrap_or_default();
                hub.last_workspace_root = msg
                    .last_workspace_root
                    .and_then(|value| if value.trim().is_empty() { None } else { Some(value) });
                hub.hub_uptime = msg
                    .hub_uptime
                    .and_then(|value| if value.trim().is_empty() { None } else { Some(value) });
            }
            let should_log = {
                let mut last = state
                    .last_hub_state_log
                    .lock()
                    .unwrap_or_else(|p| p.into_inner());
                let next = (connected, client_count, session_count);
                if last.as_ref() == Some(&next) {
                    false
                } else {
                    *last = Some(next);
                    true
                }
            };
            if should_log {
                eprintln!(
                    "[menubar-sidecar] hub_state: connected={connected} clients={client_count} sessions={session_count}"
                );
            }
            refresh_tray_menu(state);
        }
        "notification" => {
            let title = msg.title.unwrap_or_default();
            let body = msg.body.unwrap_or_default();
            let severity = msg.severity.unwrap_or_else(|| "info".to_string());
            eprintln!("[notification/{severity}] {title}: {body}");
            if let Ok(mut hub) = state.hub_state.lock() {
                hub.notifications.push(NotificationRecord {
                    title: title.clone(),
                    body: body.clone(),
                    severity,
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                });
                if hub.notifications.len() > 50 {
                    let keep_from = hub.notifications.len() - 50;
                    hub.notifications.drain(0..keep_from);
                }
            }
            show_system_notification(&title, &body);
            refresh_tray_menu(state);
        }
        _ => {
            eprintln!("[menubar-sidecar] {raw}");
        }
    }
}

fn escape_applescript(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn show_system_notification(title: &str, body: &str) {
    let escaped_title = escape_applescript(title);
    let escaped_body = escape_applescript(body);
    let script = format!(
        "display notification \"{escaped_body}\" with title \"{escaped_title}\""
    );
    let _ = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

fn show_notification_details(title: &str, body: &str) {
    let escaped_title = escape_applescript(title);
    let escaped_body = escape_applescript(body);
    let script = format!(
        "display dialog \"{escaped_body}\" with title \"{escaped_title}\" buttons {{\"OK\"}} default button \"OK\""
    );
    let _ = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

fn prompt_for_new_chat(workspace_root: &str) -> Option<String> {
    let escaped_workspace = escape_applescript(workspace_root);
    let script = format!(
        "text returned of (display dialog \"Start a background chat for:\\n{escaped_workspace}\" default answer \"\" with title \"New Chat\")"
    );
    let output = Command::new("osascript").arg("-e").arg(script).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let prompt = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if prompt.is_empty() {
        None
    } else {
        Some(prompt)
    }
}

fn send_sidecar_command(state: &Arc<AppState>, command: serde_json::Value) -> Result<(), String> {
    let mut guard = state
        .sidecar_process
        .lock()
        .map_err(|_| "failed to lock sidecar process".to_string())?;
    let child = guard
        .as_mut()
        .ok_or_else(|| "menubar sidecar is not running".to_string())?;
    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| "menubar sidecar stdin is unavailable".to_string())?;
    let payload = serde_json::to_string(&command)
        .map_err(|error| format!("failed to serialize sidecar command: {error}"))?;
    stdin
        .write_all(payload.as_bytes())
        .map_err(|error| format!("failed to write sidecar command: {error}"))?;
    stdin
        .write_all(b"\n")
        .map_err(|error| format!("failed to flush sidecar command: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("failed to flush sidecar stdin: {error}"))?;
    Ok(())
}

fn refresh_tray_menu(state: &Arc<AppState>) {
    let app_handle = state
        .app_handle
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    let Some(app_handle) = app_handle else {
        return;
    };
    let hub_state = state
        .hub_state
        .lock()
        .map(|hub| hub.clone())
        .unwrap_or_default();
    let Ok(menu) = build_tray_menu(&app_handle, &hub_state) else {
        return;
    };
    if let Some(tray) = app_handle.tray_by_id(TRAY_ID) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_tray_menu(
    app: &tauri::AppHandle,
    hub_state: &HubState,
) -> tauri::Result<Menu<tauri::Wry>> {
    let status_text = if hub_state.connected {
        "Hub Connected".to_string()
    } else {
        "Hub: disconnected".to_string()
    };

    let status_item = MenuItem::with_id(app, "status", &status_text, false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> =
        vec![Box::new(status_item), Box::new(sep1)];

    if hub_state.connected {
        if let Some(uptime) = hub_state.hub_uptime.as_ref() {
            items.push(Box::new(MenuItem::with_id(
                app,
                "hub_uptime",
                &format!("Uptime: {uptime}"),
                false,
                None::<&str>,
            )?));
        }
        for (index, summary) in hub_state.client_summaries.iter().enumerate() {
            let row_text = format!(
                "{}: {}, Sessions: {}",
                summary.label, summary.name, summary.session_count
            );
            items.push(Box::new(MenuItem::with_id(
                app,
                format!("client_summary_{index}"),
                &row_text,
                false,
                None::<&str>,
            )?));
        }
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
    }

    let new_chat_item = MenuItem::with_id(
        app,
        "new_chat",
        "New Session",
        hub_state.last_workspace_root.is_some(),
        None::<&str>,
    )?;
    items.push(Box::new(new_chat_item));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    let notif_count = hub_state.notifications.len();
    let notif_text = if notif_count == 0 {
        "No notifications".to_string()
    } else {
        format!(
            "{notif_count} notification{}",
            if notif_count == 1 { "" } else { "s" }
        )
    };
    let notif_item = MenuItem::with_id(
        app,
        "notifications",
        &notif_text,
        notif_count > 0,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Cline Hub", true, None::<&str>)?;

    items.push(Box::new(notif_item));
    items.push(Box::new(sep2));
    items.push(Box::new(quit_item));

    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|item| item.as_ref()).collect();
    Menu::with_items(app, &item_refs)
}

#[tauri::command]
fn get_hub_state(state: tauri::State<'_, Arc<AppState>>) -> serde_json::Value {
    let hub = state.hub_state.lock().unwrap_or_else(|p| p.into_inner());
    serde_json::json!({
        "connected": hub.connected,
        "clientSummaries": hub.client_summaries,
        "lastWorkspaceRoot": hub.last_workspace_root,
        "hubUptime": hub.hub_uptime,
        "notificationCount": hub.notifications.len(),
        "recentNotifications": &hub.notifications[hub.notifications.len().saturating_sub(10)..],
    })
}

fn main() {
    let app_state = Arc::new(AppState::new());
    let launch_cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    let workspace_root = std::process::Command::new("git")
        .args(["-C", &launch_cwd, "rev-parse", "--show-toplevel"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        })
        .unwrap_or_else(|| launch_cwd.clone());

    let state_for_setup = app_state.clone();
    let workspace_root_for_setup = workspace_root.clone();
    let launch_cwd_for_setup = launch_cwd.clone();

    let state_for_watchdog = app_state.clone();
    let workspace_root_for_watchdog = workspace_root.clone();
    let launch_cwd_for_watchdog = launch_cwd.clone();

    tauri::Builder::default()
        .manage(app_state)
        .setup(move |app| {
            if let Ok(mut app_handle) = state_for_setup.app_handle.lock() {
                *app_handle = Some(app.handle().clone());
            }
            if let Err(e) = start_sidecar(
                &state_for_setup,
                &workspace_root_for_setup,
                &launch_cwd_for_setup,
            ) {
                eprintln!("[menubar] sidecar start failed: {e}");
            }

            thread::spawn(move || loop {
                thread::sleep(Duration::from_secs(5));
                if let Err(e) = start_sidecar(
                    &state_for_watchdog,
                    &workspace_root_for_watchdog,
                    &launch_cwd_for_watchdog,
                ) {
                    eprintln!("[menubar] watchdog restart failed: {e}");
                }
            });

            let hub_state = HubState::default();
            let menu = build_tray_menu(app.handle(), &hub_state)?;

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
                    tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
                        .expect("failed to load tray icon")
                }))
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "quit" => app.exit(0),
                        "new_chat" => {
                            let state = app.state::<Arc<AppState>>();
                            let workspace_root = {
                                let hub = state.hub_state.lock().unwrap_or_else(|p| p.into_inner());
                                hub.last_workspace_root.clone()
                            };
                            let Some(workspace_root) = workspace_root else {
                                show_notification_details(
                                    "New Chat unavailable",
                                    "No recent workspace is available yet.",
                                );
                                return;
                            };
                            let Some(prompt) = prompt_for_new_chat(&workspace_root) else {
                                return;
                            };
                            if let Err(error) = send_sidecar_command(
                                state.inner(),
                                serde_json::json!({
                                    "type": "new_chat",
                                    "prompt": prompt,
                                }),
                            ) {
                                show_notification_details("New Chat failed", &error);
                            }
                        }
                        "notifications" => {
                            let state = app.state::<Arc<AppState>>();
                            let notification = {
                                let mut hub =
                                    state.hub_state.lock().unwrap_or_else(|p| p.into_inner());
                                hub.notifications.pop()
                            };
                            if let Some(notification) = notification {
                                show_notification_details(&notification.title, &notification.body);
                                refresh_tray_menu(&state.inner().clone());
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|_tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        // menu appears automatically via show_menu_on_left_click
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_hub_state])
        .run(tauri::generate_context!())
        .expect("error running menubar app");
}
