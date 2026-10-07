use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub fn host_target() -> &'static str {
    if cfg!(target_os = "macos") {
        "universal-apple-darwin"
    } else if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64-unknown-linux-gnu"
    } else {
        "x86_64-unknown-linux-gnu"
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeIdentity {
    build_id: String,
    core_version: String,
    #[serde(default)]
    build_epoch_ms: Option<u64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    #[serde(flatten)]
    identity: RuntimeIdentity,
    executable_path: PathBuf,
    compiled: bool,
    #[serde(default)]
    launch_env: HashMap<String, String>,
}

#[derive(Debug)]
pub struct InstalledRuntime {
    pub executable_path: PathBuf,
    pub launch_env: HashMap<String, String>,
}
impl InstalledRuntime {
    pub fn direct(executable_path: PathBuf) -> Self {
        Self {
            executable_path,
            launch_env: HashMap::new(),
        }
    }
}

pub fn release_tag(installer_dir: &Path) -> Result<String, String> {
    let release = std::fs::read_to_string(installer_dir.join("release.txt"))
        .map_err(|error| format!("runtime release manifest missing: {error}"))?;
    let release = release.trim();
    if release.is_empty()
        || !release
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
    {
        return Err("invalid runtime release manifest".into());
    }
    Ok(release.to_string())
}

// Installed commands may be npm wrappers. Ask the CLI for its real executable
// and SDK identity rather than guessing its package layout or version.
fn probe(command: &Path) -> Option<RuntimeInfo> {
    let mut process = if cfg!(windows)
        && command
            .extension()
            .is_some_and(|ext| ext == "cmd" || ext == "bat")
    {
        let mut process = Command::new("cmd.exe");
        process.args(["/d", "/c"]).arg(command);
        process
    } else {
        Command::new(command)
    };
    process.arg("--runtime-info");
    let text = bounded_output(&mut process)?;
    serde_json::from_str(text.trim()).ok()
}

fn bounded_output(command: &mut Command) -> Option<String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("CLINE_NO_AUTO_UPDATE", "1")
        .env_remove("BUN_BE_BUN");
    super::hide_console_window(command);
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().ok()?;
                return status
                    .success()
                    .then(|| String::from_utf8_lossy(&output.stdout).into_owned());
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn installed_candidates(shared_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let names: &[&str] = if cfg!(windows) {
        &["cline.exe", "cline.cmd", "cline.bat"]
    } else {
        &["cline"]
    };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path).filter(|p| p.is_absolute()) {
            for name in names {
                candidates.push(directory.join(name));
            }
        }
    }
    // Finder/Dock launches often don't inherit the user's terminal PATH.
    #[cfg(unix)]
    {
        let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/sh".into());
        let output = bounded_output(Command::new(shell).args(["-ilc", "command -v cline || true"]))
            .ok_or("Could not inspect your interactive shell for an installed CLI. Check its startup configuration before retrying; no second CLI was installed.")?;
        if let Some(path) = output
            .lines()
            .rev()
            .map(|line| PathBuf::from(line.trim()))
            .find(|path| path.is_absolute() && path.is_file())
        {
            candidates.push(path);
        }
    }
    candidates.push(shared_dir.join(if cfg!(windows) { "cline.exe" } else { "cline" }));
    candidates.retain(|path| path.is_file());
    candidates.dedup();
    Ok(candidates)
}

fn compatible_path(path: &Path, identity: &RuntimeIdentity) -> Result<InstalledRuntime, String> {
    let info = probe(path).ok_or_else(|| format!("Installed CLI at {} cannot report its SDK identity. Update or remove that installation before launching desktop; no second CLI was installed.", path.display()))?;
    if !info.compiled
        || info.identity.build_id != identity.build_id
        || info.identity.core_version != identity.core_version
    {
        return Err(format!("Installed CLI at {} has an incompatible SDK build. Update or remove that installation before launching desktop; no second CLI was installed.", path.display()));
    }
    if !info.executable_path.is_absolute() || !info.executable_path.is_file() {
        return Err("Installed CLI reported an invalid executable path".into());
    }
    Ok(InstalledRuntime {
        executable_path: info.executable_path,
        launch_env: info
            .launch_env
            .into_iter()
            .filter(|(key, _)| key == "NODE_EXTRA_CA_CERTS" || key == "CLINE_WRAPPER_PATH")
            .collect(),
    })
}

pub fn install(
    installer_dir: &Path,
    shared_dir: &Path,
    release: &str,
    cancelled: &AtomicBool,
) -> Result<InstalledRuntime, String> {
    install_with_candidates(
        installer_dir,
        shared_dir,
        release,
        installed_candidates(shared_dir)?,
        cancelled,
    )
}

fn install_with_candidates(
    installer_dir: &Path,
    shared_dir: &Path,
    release: &str,
    candidates: Vec<PathBuf>,
    cancelled: &AtomicBool,
) -> Result<InstalledRuntime, String> {
    let identity: RuntimeIdentity = serde_json::from_slice(
        &std::fs::read(installer_dir.join("identity.json"))
            .map_err(|e| format!("runtime identity manifest missing: {e}"))?,
    )
    .map_err(|e| format!("invalid runtime identity manifest: {e}"))?;
    let cli = shared_dir.join(if cfg!(windows) { "cline.exe" } else { "cline" });
    // One shared standalone install is upgraded in place. An external install
    // remains owned by its package manager: reuse it or surface incompatibility.
    for candidate in candidates {
        let actual = std::fs::canonicalize(&candidate).unwrap_or_else(|_| candidate.clone());
        let shared = std::fs::canonicalize(&cli).unwrap_or_else(|_| cli.clone());
        if actual != shared {
            return compatible_path(&candidate, &identity);
        }
    }
    if cli.is_file() {
        if let Ok(path) = compatible_path(&cli, &identity) {
            return Ok(path);
        }
        if let Some(info) = probe(&cli) {
            if info
                .identity
                .build_epoch_ms
                .zip(identity.build_epoch_ms)
                .is_some_and(|(installed, expected)| installed > expected)
            {
                return Err("The shared CLI is newer than this desktop build. Update desktop to use the shared CLI; no duplicate or downgrade was installed.".into());
            }
        }
    }
    let mut command;
    if cfg!(windows) {
        command = Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(installer_dir.join("install.ps1"))
            .arg("-Release")
            .arg(release)
            .arg("-Target")
            .arg(host_target())
            .arg("-InstallDir")
            .arg(shared_dir);
    } else {
        command = Command::new("/bin/bash");
        command
            .arg(installer_dir.join("install.sh"))
            .arg("--release")
            .arg(release)
            .arg("--target")
            .arg(host_target())
            .arg("--install-dir")
            .arg(shared_dir);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    super::hide_console_window(&mut command);
    command.env(
        "CLINE_INSTALL_BUILD_EPOCH_MS",
        identity.build_epoch_ms.unwrap_or(0).to_string(),
    );
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to run CLI installer: {error}"))?;
    loop {
        if cancelled.load(Ordering::Acquire) {
            #[cfg(unix)]
            let _ = Command::new("kill")
                .args(["-TERM", "--", &format!("-{}", child.id())])
                .status();
            #[cfg(windows)]
            let _ = Command::new("taskkill")
                .args(["/T", "/F", "/PID", &child.id().to_string()])
                .status();
            let _ = child.kill();
            let _ = child.wait();
            return Err("runtime installation cancelled during shutdown".into());
        }
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.to_string());
            }
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Cline runtime installation failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    compatible_path(&cli, &identity)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn resolves_native_binary_from_wrapper_and_rejects_mismatched_builds() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("cline runtime {stamp}"));
        std::fs::create_dir_all(&root).unwrap();
        let native = root.join("native cli");
        std::fs::write(&native, "binary").unwrap();
        let wrapper = root.join("cline");
        let report = serde_json::json!({"buildId":"sdk-build", "coreVersion":"3.0.0", "compiled":true, "executablePath":native, "launchEnv":{"NODE_EXTRA_CA_CERTS":"/certificates/company.pem", "CLINE_WRAPPER_PATH":"/installed/cline", "UNRELATED":"ignored"}});
        std::fs::write(
            &wrapper,
            format!("#!/bin/sh\ncat <<'JSON'\n{report}\nJSON\n"),
        )
        .unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
        let identity = RuntimeIdentity {
            build_id: "sdk-build".into(),
            core_version: "3.0.0".into(),
            build_epoch_ms: None,
        };
        let launch = compatible_path(&wrapper, &identity).unwrap();
        assert_eq!(
            launch.launch_env.get("NODE_EXTRA_CA_CERTS").unwrap(),
            "/certificates/company.pem"
        );
        assert!(!launch.launch_env.contains_key("UNRELATED"));
        assert_eq!(
            compatible_path(&wrapper, &identity)
                .unwrap()
                .executable_path,
            native
        );
        let mismatch = RuntimeIdentity {
            build_id: "other-build".into(),
            core_version: "3.0.0".into(),
            build_epoch_ms: None,
        };
        assert!(compatible_path(&wrapper, &mismatch)
            .unwrap_err()
            .contains("no second CLI"));
        std::fs::write(&wrapper, "#!/bin/sh\nexit 1").unwrap();
        assert!(compatible_path(&wrapper, &identity)
            .unwrap_err()
            .contains("cannot report"));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn interactive_login_shell_reads_terminal_path_setup() {
        let root = std::env::temp_dir().join(format!("cline-shell-{}", std::process::id()));
        let commands = root.join("commands");
        std::fs::create_dir_all(&commands).unwrap();
        let cli = commands.join("cline");
        std::fs::write(&cli, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(
            root.join(".zshrc"),
            format!("export PATH='{}':$PATH\n", commands.display()),
        )
        .unwrap();
        let output = bounded_output(
            Command::new("/bin/zsh")
                .args(["-ilc", "command -v cline || true"])
                .env("ZDOTDIR", &root),
        )
        .unwrap();
        assert_eq!(PathBuf::from(output.trim()), cli);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancels_an_installer_during_shutdown() {
        let root = std::env::temp_dir().join(format!("cline-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("identity.json"),
            r#"{"buildId":"test","coreVersion":"0","buildEpochMs":10}"#,
        )
        .unwrap();
        std::fs::write(root.join("install.sh"), "sleep 30\n").unwrap();
        let cancelled = AtomicBool::new(true);
        let start = Instant::now();
        let result = install_with_candidates(
            &root,
            &root.join("bin"),
            "desktop-v0.0.43",
            vec![],
            &cancelled,
        );
        assert!(result.unwrap_err().contains("cancelled"));
        assert!(start.elapsed() < Duration::from_secs(2));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shared_install_is_reused_and_never_downgraded() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("cline shared {stamp}"));
        let shared = root.join("bin");
        std::fs::create_dir_all(&shared).unwrap();
        let cli = shared.join("cline");
        let identity =
            serde_json::json!({"buildId":"expected-sdk", "coreVersion":"3.0.0", "buildEpochMs":10});
        std::fs::write(root.join("identity.json"), identity.to_string()).unwrap();
        let report = serde_json::json!({"buildId":"expected-sdk", "coreVersion":"3.0.0", "buildEpochMs":10, "compiled":true, "executablePath":cli});
        std::fs::write(&cli, format!("#!/bin/sh\ncat <<'JSON'\n{report}\nJSON\n")).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        // No installer exists: a successful result proves the existing copy was used.
        assert_eq!(
            install_with_candidates(
                &root,
                &shared,
                "desktop-v0.0.43",
                vec![],
                &AtomicBool::new(false)
            )
            .unwrap()
            .executable_path,
            cli
        );
        let newer = serde_json::json!({"buildId":"newer-sdk", "coreVersion":"3.0.0", "buildEpochMs":20, "compiled":true, "executablePath":cli});
        std::fs::write(&cli, format!("#!/bin/sh\ncat <<'JSON'\n{newer}\nJSON\n")).unwrap();
        let before = std::fs::read(&cli).unwrap();
        assert!(install_with_candidates(
            &root,
            &shared,
            "desktop-v0.0.43",
            vec![],
            &AtomicBool::new(false)
        )
        .unwrap_err()
        .contains("no duplicate or downgrade"));
        assert_eq!(std::fs::read(&cli).unwrap(), before);
        std::fs::remove_dir_all(root).unwrap();
    }
}
