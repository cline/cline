// Gateway Desktop shell (Tauri v2).
//
// The POC shell owns the window, its bundled Gateway (when this process wins
// singleton startup), the broker, the random bridge secret, and one fixed
// diagnostics command. The Gateway runs in a dedicated namespace so it never
// replaces or controls another Cline installation's authority.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use rand::RngCore;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, State};

const READY_TIMEOUT: Duration = Duration::from_secs(20);
const DEFAULT_GATEWAY_NAMESPACE: &str = "default";
const DEFAULT_LEAD_PROFILE: &str = "cline-dad";

#[derive(Clone, Serialize)]
struct BridgeEndpoint {
    port: u16,
    secret: String,
}

struct ShellState {
    endpoint: BridgeEndpoint,
    broker: Mutex<Option<Child>>,
    gateway: Mutex<Option<Child>>,
}

fn random_secret() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn workspace_root() -> Option<PathBuf> {
    // Dev layout: src-tauri/ lives inside apps/gateway-desktop.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.parent().map(|parent| parent.to_path_buf())
}

fn gateway_namespace() -> String {
    std::env::var("GATEWAY_DESKTOP_GATEWAY_NAMESPACE")
        .or_else(|_| std::env::var("CLINE_GATEWAY_NAMESPACE"))
        .unwrap_or_else(|_| DEFAULT_GATEWAY_NAMESPACE.to_string())
}

fn lead_profile() -> String {
    std::env::var("GATEWAY_DESKTOP_LEAD_PROFILE")
        .unwrap_or_else(|_| DEFAULT_LEAD_PROFILE.to_string())
}

fn lead_profiles_dir() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("CLINE_GATEWAY_PROFILES_DIR") {
        let path = PathBuf::from(explicit);
        if path.join("cline-dad").join("profile.json").exists() {
            return Some(path);
        }
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("default-agent");
    if development.join("cline-dad").join("profile.json").exists() {
        return Some(development);
    }
    let executable = std::env::current_exe().ok()?;
    let packaged = executable
        .parent()?
        .join("..")
        .join("Resources")
        .join("resources")
        .join("default-agent");
    packaged
        .join("cline-dad")
        .join("profile.json")
        .exists()
        .then_some(packaged)
}

/// Locate the packaged Gateway sidecar, with a source fallback for `tauri dev`.
fn gateway_command() -> Result<Command, String> {
    if let Ok(explicit) = std::env::var("GATEWAY_DESKTOP_GATEWAY_BIN") {
        let path = PathBuf::from(explicit);
        if path.exists() {
            return Ok(Command::new(path));
        }
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            for name in ["cline-gateway", "cline-gateway.exe"] {
                let candidate = dir.join(name);
                if candidate.exists() {
                    return Ok(Command::new(candidate));
                }
            }
        }
    }
    let app_root = workspace_root().ok_or("cannot locate the app directory")?;
    let entry = app_root
        .join("..")
        .join("..")
        .join("sdk")
        .join("packages")
        .join("gateway")
        .join("bin")
        .join("cline-gateway.mjs");
    if !entry.exists() {
        return Err(format!(
            "Gateway entry not found at {} and no bundled sidecar is present",
            entry.display()
        ));
    }
    let mut command = Command::new("bun");
    command.arg("run").arg(entry).current_dir(app_root);
    Ok(command)
}

/// Start the namespaced Gateway, or attach when another copy already owns it.
fn ensure_gateway(namespace: &str) -> Result<Option<Child>, String> {
    let mut command = gateway_command()?;
    if let Some(profiles_dir) = lead_profiles_dir() {
        command.env("CLINE_GATEWAY_PROFILES_DIR", profiles_dir);
    }
    command
        .arg("serve")
        .arg("--namespace")
        .arg(namespace)
        .arg("--lead-profile")
        .arg(lead_profile())
        .env("CLINE_GATEWAY_NAMESPACE", namespace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn the bundled Gateway: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Gateway stdout was not captured")?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|error| format!("failed reading Gateway readiness: {error}"))?;
    if line.trim().is_empty() {
        let status = child
            .wait()
            .map(|status| status.to_string())
            .unwrap_or_else(|error| format!("unknown status ({error})"));
        return Err(format!(
            "the bundled Gateway exited before readiness ({status})"
        ));
    }
    let value = serde_json::from_str::<serde_json::Value>(line.trim())
        .map_err(|error| format!("invalid Gateway readiness response: {error}"))?;
    match value.get("status").and_then(|status| status.as_str()) {
        Some("serving") => Ok(Some(child)),
        Some("already_running") => {
            let _ = child.wait();
            Ok(None)
        }
        status => {
            let _ = child.kill();
            Err(format!("Gateway failed readiness with status {status:?}"))
        }
    }
}

fn stop_owned_gateway(namespace: &str, mut child: Child) {
    if let Ok(mut command) = gateway_command() {
        let stopped = command
            .arg("stop")
            .arg("--namespace")
            .arg(namespace)
            .env("CLINE_GATEWAY_NAMESPACE", namespace)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if stopped {
            let _ = child.wait();
            return;
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Locate the compiled broker sidecar next to the app binary
/// (bundled builds), or fall back to `bun run native/index.ts` for
/// development.
fn broker_command() -> Result<Command, String> {
    if let Ok(explicit) = std::env::var("GATEWAY_DESKTOP_BROKER_BIN") {
        let path = PathBuf::from(explicit);
        if path.exists() {
            return Ok(Command::new(path));
        }
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            for name in ["gateway-desktop-broker", "gateway-desktop-broker.exe"] {
                let candidate = dir.join(name);
                if candidate.exists() {
                    return Ok(Command::new(candidate));
                }
            }
        }
    }
    let root = workspace_root().ok_or("cannot locate the app directory")?;
    let entry = root.join("native").join("index.ts");
    if !entry.exists() {
        return Err(format!(
            "broker entry not found at {} and no compiled sidecar is present",
            entry.display()
        ));
    }
    let mut command = Command::new("bun");
    command.arg("run").arg(entry).current_dir(root);
    Ok(command)
}

fn spawn_broker(secret: &str, namespace: &str) -> Result<(Child, u16), String> {
    let mut command = broker_command()?;
    command
        // The secret travels via environment, never argv (visible in ps).
        .env("GATEWAY_DESKTOP_BRIDGE_SECRET", secret)
        .env("CLINE_GATEWAY_NAMESPACE", namespace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn the broker: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("broker stdout was not captured")?;
    let mut reader = BufReader::new(stdout);
    let started = Instant::now();
    let mut line = String::new();
    loop {
        if started.elapsed() > READY_TIMEOUT {
            let _ = child.kill();
            return Err("timed out waiting for the broker ready line".into());
        }
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => {
                let _ = child.kill();
                return Err("the broker exited before becoming ready".into());
            }
            Ok(_) => {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                    if value.get("type").and_then(|v| v.as_str()) == Some("ready") {
                        if let Some(port) = value.get("port").and_then(|v| v.as_u64()) {
                            return Ok((child, port as u16));
                        }
                    }
                }
            }
            Err(error) => {
                let _ = child.kill();
                return Err(format!("failed reading broker stdout: {error}"));
            }
        }
    }
}

/// The ONLY channel through which the webview learns the bridge
/// endpoint and per-launch secret (never URLs, never env vars).
#[tauri::command]
fn bridge_endpoint(state: State<ShellState>) -> BridgeEndpoint {
    state.endpoint.clone()
}

/// Fixed native capability: reveal the diagnostics folder. This is the
/// entire filesystem surface of the shell.
#[tauri::command]
fn reveal_diagnostics() -> Result<(), String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "cannot resolve the home directory")?;
    let folder = PathBuf::from(home)
        .join(".cline")
        .join("gateway-desktop")
        .join("logs");
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    Command::new(opener)
        .arg(&folder)
        .spawn()
        .map_err(|error| format!("failed to reveal {}: {error}", folder.display()))?;
    Ok(())
}

fn main() {
    let secret = random_secret();
    let namespace = gateway_namespace();
    let gateway = match ensure_gateway(&namespace) {
        Ok(gateway) => gateway,
        Err(error) => {
            eprintln!("gateway-desktop: {error}");
            std::process::exit(1);
        }
    };
    let (broker, port) = match spawn_broker(&secret, &namespace) {
        Ok(result) => result,
        Err(error) => {
            if let Some(gateway) = gateway {
                stop_owned_gateway(&namespace, gateway);
            }
            eprintln!("gateway-desktop: {error}");
            std::process::exit(1);
        }
    };

    let state = ShellState {
        endpoint: BridgeEndpoint { port, secret },
        broker: Mutex::new(Some(broker)),
        gateway: Mutex::new(gateway),
    };

    let app = tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            bridge_endpoint,
            reveal_diagnostics
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Gateway Desktop shell");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            // Stop the broker with the app. This never interrupts runs:
            // the Gateway owns them and outlives every client.
            let state: State<ShellState> = app_handle.state();
            let child = state.broker.lock().ok().and_then(|mut guard| guard.take());
            if let Some(mut child) = child {
                let _ = child.kill();
                let _ = child.wait();
            }
            let gateway = state.gateway.lock().ok().and_then(|mut guard| guard.take());
            if let Some(gateway) = gateway {
                stop_owned_gateway(&gateway_namespace(), gateway);
            }
        }
    });
}
