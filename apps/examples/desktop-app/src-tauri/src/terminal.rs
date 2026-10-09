//! Integrated terminal: one PTY per webview terminal tab, streamed over an
//! IPC channel. The webview owns the xterm.js instance and its scrollback;
//! this side only spawns the shell, pumps bytes, and tracks exits.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    Data { data: String },
    Exit { code: Option<u32> },
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    /// Input is queued to a per-session writer thread: a write blocks when the
    /// shell stops reading (a large paste into a sleeping command), and that
    /// must stall neither the IPC command thread nor kill/exit.
    input: Sender<Vec<u8>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

type Sessions = Arc<Mutex<HashMap<String, TerminalSession>>>;

#[derive(Default)]
pub struct TerminalState {
    sessions: Sessions,
}

impl TerminalState {
    /// Kills every live shell; called on app exit so none outlive the window.
    pub fn kill_all(&self) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        for (_, mut session) in sessions.drain() {
            let _ = session.killer.kill();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnOptions {
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// The requested directory when it exists, otherwise the user's home: a
/// deleted worktree or a draft with no workspace should still open a shell.
fn resolve_cwd(requested: Option<&str>) -> Option<PathBuf> {
    requested
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty())
        .map(Path::new)
        .filter(|path| path.is_dir())
        .map(Path::to_path_buf)
        .or_else(home_dir)
}

fn shell_command() -> CommandBuilder {
    #[cfg(windows)]
    {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        cmd
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.trim().is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".to_string()
                } else {
                    "/bin/bash".to_string()
                }
            });
        let mut cmd = CommandBuilder::new(&shell);
        // A GUI-launched app inherits a minimal PATH; a login shell sources the
        // user's profile so the terminal has the same PATH as Terminal.app.
        if login_shell_supported(&shell) {
            cmd.arg("-l");
        }
        cmd
    }
}

#[cfg(not(windows))]
fn login_shell_supported(shell: &str) -> bool {
    matches!(
        Path::new(shell)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(""),
        "zsh" | "bash" | "fish" | "sh" | "dash" | "ksh" | "tcsh" | "csh"
    )
}

/// Decodes as much as possible, replacing invalid bytes, but holds back an
/// incomplete trailing sequence so a multi-byte character split across two
/// reads is not emitted as replacement characters.
fn split_utf8(bytes: Vec<u8>) -> (String, Vec<u8>) {
    let mut text = String::new();
    let mut rest: &[u8] = &bytes;
    loop {
        match std::str::from_utf8(rest) {
            Ok(valid) => {
                text.push_str(valid);
                return (text, Vec::new());
            }
            Err(error) => {
                let valid = error.valid_up_to();
                text.push_str(std::str::from_utf8(&rest[..valid]).unwrap_or_default());
                match error.error_len() {
                    // Unexpected end of input: the rest is a sequence still in flight.
                    None => return (text, rest[valid..].to_vec()),
                    Some(invalid) => {
                        text.push('\u{FFFD}');
                        rest = &rest[valid + invalid..];
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub fn terminal_spawn(
    state: State<'_, TerminalState>,
    options: SpawnOptions,
    on_event: Channel<TerminalEvent>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: options.rows.max(1),
            cols: options.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Failed to open a pseudo-terminal: {error}"))?;

    let mut cmd = shell_command();
    if let Some(cwd) = resolve_cwd(options.cwd.as_deref()) {
        cmd.cwd(cwd);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Cline");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|error| format!("Failed to start the shell: {error}"))?;
    // The slave end stays open in the child; dropping ours lets reads return
    // EOF when the shell exits.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Failed to read from the terminal: {error}"))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Failed to write to the terminal: {error}"))?;
    let killer = child.clone_killer();

    // Ends when the session is removed (sender dropped) or the PTY closes
    // under a blocked write after the shell is killed.
    let (input, input_rx) = channel::<Vec<u8>>();
    std::thread::Builder::new()
        .name(format!("pty-writer-{}", options.id))
        .spawn(move || {
            for chunk in input_rx {
                if writer.write_all(&chunk).is_err() {
                    break;
                }
            }
        })
        .map_err(|error| {
            let _ = child.clone_killer().kill();
            format!("Failed to start the terminal writer: {error}")
        })?;

    let sessions = state.sessions.clone();
    {
        let mut map = sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut previous) = map.insert(
            options.id.clone(),
            TerminalSession {
                master: pair.master,
                input,
                killer,
            },
        ) {
            let _ = previous.killer.kill();
        }
    }

    let id = options.id;
    let reader_sessions = sessions.clone();
    let reader_id = id.clone();
    std::thread::Builder::new()
        .name(format!("pty-reader-{id}"))
        .spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            let mut carry: Vec<u8> = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        carry.extend_from_slice(&buf[..n]);
                        let (text, rest) = split_utf8(std::mem::take(&mut carry));
                        carry = rest;
                        if !text.is_empty() && on_event.send(TerminalEvent::Data { data: text }).is_err() {
                            break;
                        }
                    }
                }
            }
            let code = child.wait().ok().map(|status| status.exit_code());
            reader_sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&reader_id);
            let _ = on_event.send(TerminalEvent::Exit { code });
        })
        .map_err(|error| {
            // Without a reader nobody would notice the shell exit; don't leave it running.
            if let Some(mut session) = sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id)
            {
                let _ = session.killer.kill();
            }
            format!("Failed to start the terminal reader: {error}")
        })?;

    Ok(())
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    let session = sessions
        .get(&id)
        .ok_or_else(|| "The terminal is no longer running.".to_string())?;
    // Unbounded channel: never blocks the command thread.
    session
        .input
        .send(data.into_bytes())
        .map_err(|_| "The terminal is no longer running.".to_string())
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    let session = sessions
        .get(&id)
        .ok_or_else(|| "The terminal is no longer running.".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_kill(state: State<'_, TerminalState>, id: String) {
    let removed = state
        .sessions
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id);
    if let Some(mut session) = removed {
        let _ = session.killer.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_utf8_carries_incomplete_trailing_sequence() {
        // "é" is 0xC3 0xA9; cut after the lead byte.
        let (text, carry) = split_utf8(vec![b'a', 0xC3]);
        assert_eq!(text, "a");
        assert_eq!(carry, vec![0xC3]);
        let (text, carry) = split_utf8([carry, vec![0xA9, b'b']].concat());
        assert_eq!(text, "éb");
        assert!(carry.is_empty());
    }

    #[test]
    fn split_utf8_replaces_invalid_bytes_instead_of_stalling() {
        let (text, carry) = split_utf8(vec![b'a', 0xFF, b'b']);
        assert_eq!(text, "a\u{FFFD}b");
        assert!(carry.is_empty());
    }

    #[test]
    fn split_utf8_keeps_incomplete_suffix_after_invalid_bytes() {
        let (text, carry) = split_utf8(vec![b'a', 0xFF, 0xC3]);
        assert_eq!(text, "a\u{FFFD}");
        assert_eq!(carry, vec![0xC3]);
        let (text, carry) = split_utf8([carry, vec![0xA9]].concat());
        assert_eq!(text, "é");
        assert!(carry.is_empty());
    }

    #[test]
    fn resolve_cwd_falls_back_to_home_for_missing_directories() {
        let temp = std::env::temp_dir();
        assert_eq!(
            resolve_cwd(Some(temp.to_str().unwrap())),
            Some(temp.clone())
        );
        assert_eq!(resolve_cwd(Some("/definitely/not/a/dir")), home_dir());
        assert_eq!(resolve_cwd(Some("   ")), home_dir());
        assert_eq!(resolve_cwd(None), home_dir());
    }
}
