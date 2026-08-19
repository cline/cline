// Gateway Desktop shell (Tauri v2).
//
// The shell owns exactly four things: the window, the random per-launch
// bridge secret, the broker child process, and one fixed native command
// to reveal the diagnostics folder. It does NOT import the Cline SDK,
// implement Gateway commands, or ever start/stop/replace a Gateway.
// Closing the window never interrupts a run: the broker only closes its
// sockets, and the Gateway owns every run.

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

#[derive(Clone, Serialize)]
struct BridgeEndpoint {
    port: u16,
    secret: String,
}

struct ShellState {
    endpoint: BridgeEndpoint,
    broker: Mutex<Option<Child>>,
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
            for name in [
                "gateway-desktop-broker",
                "gateway-desktop-broker.exe",
            ] {
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

fn spawn_broker(secret: &str) -> Result<(Child, u16), String> {
    let mut command = broker_command()?;
    command
        // The secret travels via environment, never argv (visible in ps).
        .env("GATEWAY_DESKTOP_BRIDGE_SECRET", secret)
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
                        if let Some(port) =
                            value.get("port").and_then(|v| v.as_u64())
                        {
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
    let (broker, port) = match spawn_broker(&secret) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("gateway-desktop: {error}");
            std::process::exit(1);
        }
    };

    let state = ShellState {
        endpoint: BridgeEndpoint { port, secret },
        broker: Mutex::new(Some(broker)),
    };

    let app = tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![bridge_endpoint, reveal_diagnostics])
        .build(tauri::generate_context!())
        .expect("error while building the Gateway Desktop shell");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            // Stop the broker with the app. This never interrupts runs:
            // the Gateway owns them and outlives every client.
			let state: State<ShellState> = app_handle.state();
            let child = state
                .broker
                .lock()
                .ok()
                .and_then(|mut guard| guard.take());
            if let Some(mut child) = child {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
