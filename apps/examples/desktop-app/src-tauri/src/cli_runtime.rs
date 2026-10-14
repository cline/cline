use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct InstallationControl {
    cancelled: AtomicBool,
    process: Mutex<Option<u32>>,
}
impl InstallationControl {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
    pub fn cancel(&self) {
        let process = self
            .process
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.cancelled.store(true, Ordering::Release);
        if let Some(pid) = *process {
            terminate_installer(pid);
        }
    }
    fn spawn(&self, command: &mut Command) -> Result<(Child, InstallationGuard<'_>), String> {
        // Hold registration across spawn so quit cannot miss a newly born process.
        let mut process = self
            .process
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if self.is_cancelled() {
            return Err("runtime installation cancelled during shutdown".into());
        }
        let child = command
            .spawn()
            .map_err(|error| format!("failed to run CLI installer: {error}"))?;
        *process = Some(child.id());
        Ok((child, InstallationGuard(self)))
    }
}
struct InstallationGuard<'a>(&'a InstallationControl);
impl Drop for InstallationGuard<'_> {
    fn drop(&mut self) {
        *self
            .0
            .process
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
    }
}
fn terminate_installer(pid: u32) {
    #[cfg(unix)]
    let mut command = {
        let mut command = Command::new("/bin/kill");
        command.args(["-KILL", "--", &format!("-{pid}")]);
        command
    };
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("taskkill");
        command.args(["/T", "/F", "/PID", &pid.to_string()]);
        command
    };
    command.stdout(Stdio::null()).stderr(Stdio::null());
    super::hide_console_window(&mut command);
    let _ = command.status();
}

pub fn host_target() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
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
fn probe(command: &Path, launch_env: &HashMap<String, String>) -> Option<RuntimeInfo> {
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
    process.arg("--runtime-info").envs(launch_env);
    let text = bounded_output(&mut process)?;
    serde_json::from_str(text.trim()).ok()
}

fn bounded_output(command: &mut Command) -> Option<String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("CLINE_NO_AUTO_UPDATE", "1")
        .env_remove("BUN_BE_BUN")
        .env_remove("CLINE_HUB_BUILD_ID")
        .env_remove("CLINE_HUB_BUILD_EPOCH_MS");
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

#[derive(Debug)]
struct InstalledCandidate {
    path: PathBuf,
    launch_env: HashMap<String, String>,
}

impl InstalledCandidate {
    fn direct(path: PathBuf) -> Self {
        Self {
            path,
            launch_env: HashMap::new(),
        }
    }
}

#[cfg(unix)]
fn login_shell_candidate(shell: &mut Command) -> Result<Option<InstalledCandidate>, String> {
    // NUL-delimited fields isolate the result from shell startup banners. Carry
    // the resolved PATH into the probe: npm/nvm wrappers need /usr/bin/env node.
    let output = bounded_output(shell.args(["-ilc", r#"printf '\0CLINE_RUNTIME\0'; command -v cline || true; printf '\0'; /usr/bin/printenv PATH; printf '\0'; /usr/bin/printenv NODE_EXTRA_CA_CERTS; printf '\0'"#]))
        .ok_or("Could not inspect your interactive shell for an installed CLI. Check its startup configuration before retrying; no second CLI was installed.")?;
    let (_, fields) = output
        .rsplit_once("\0CLINE_RUNTIME\0")
        .ok_or("Interactive shell did not report its CLI environment")?;
    let mut fields = fields.split('\0');
    let path = PathBuf::from(fields.next().unwrap_or_default().trim());
    let mut launch_env = HashMap::new();
    let path_env = fields.next().unwrap_or_default();
    launch_env.insert(
        "PATH".into(),
        path_env.strip_suffix('\n').unwrap_or(path_env).into(),
    );
    if let Some(certificates) = fields
        .next()
        .map(|value| value.strip_suffix('\n').unwrap_or(value))
        .filter(|value| !value.is_empty())
    {
        launch_env.insert("NODE_EXTRA_CA_CERTS".into(), certificates.into());
    }
    Ok((path.is_absolute() && path.is_file()).then_some(InstalledCandidate { path, launch_env }))
}

fn installed_candidates(shared_dir: &Path) -> Result<Vec<InstalledCandidate>, String> {
    let names: &[&str] = if cfg!(windows) {
        &["cline.exe", "cline.cmd", "cline.bat"]
    } else {
        &["cline"]
    };
    let mut candidates = Vec::new();
    // Prefer the terminal's selected CLI and preserve its launch environment.
    #[cfg(unix)]
    {
        let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/sh".into());
        if let Some(candidate) = login_shell_candidate(&mut Command::new(shell))? {
            candidates.push(candidate);
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path).filter(|p| p.is_absolute()) {
            for name in names {
                candidates.push(InstalledCandidate::direct(directory.join(name)));
            }
        }
    }
    candidates.push(InstalledCandidate::direct(
        shared_dir.join(if cfg!(windows) { "cline.cmd" } else { "cline" }),
    ));
    candidates.retain(|candidate| candidate.path.is_file());
    Ok(candidates)
}

fn compatible_path(
    candidate: &InstalledCandidate,
    identity: &RuntimeIdentity,
) -> Result<InstalledRuntime, String> {
    let path = &candidate.path;
    let info = probe(path, &candidate.launch_env).ok_or_else(|| format!("Installed CLI at {} cannot report its SDK identity. Update or remove that installation before launching desktop; no second CLI was installed.", path.display()))?;
    if !info.compiled
        || info.identity.build_id != identity.build_id
        || info.identity.core_version != identity.core_version
    {
        return Err(format!("Installed CLI at {} has an incompatible SDK build. Update or remove that installation before launching desktop; no second CLI was installed.", path.display()));
    }
    if !info.executable_path.is_absolute() || !info.executable_path.is_file() {
        return Err("Installed CLI reported an invalid executable path".into());
    }
    let mut launch_env = candidate.launch_env.clone();
    launch_env.extend(
        info.launch_env
            .into_iter()
            .filter(|(key, _)| key == "NODE_EXTRA_CA_CERTS" || key == "CLINE_WRAPPER_PATH"),
    );
    Ok(InstalledRuntime {
        executable_path: info.executable_path,
        launch_env,
    })
}

pub fn install(
    installer_dir: &Path,
    shared_dir: &Path,
    release: &str,
    cancelled: &InstallationControl,
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
    candidates: Vec<InstalledCandidate>,
    cancelled: &InstallationControl,
) -> Result<InstalledRuntime, String> {
    let identity: RuntimeIdentity = serde_json::from_slice(
        &std::fs::read(installer_dir.join("identity.json"))
            .map_err(|e| format!("runtime identity manifest missing: {e}"))?,
    )
    .map_err(|e| format!("invalid runtime identity manifest: {e}"))?;
    let cli = shared_dir.join(if cfg!(windows) { "cline.cmd" } else { "cline" });
    // One shared standalone command selects a versioned release. An external install
    // remains owned by its package manager: reuse it or surface incompatibility.
    let mut shared_candidate = None;
    for candidate in candidates {
        let actual =
            std::fs::canonicalize(&candidate.path).unwrap_or_else(|_| candidate.path.clone());
        let shared = std::fs::canonicalize(&cli).unwrap_or_else(|_| cli.clone());
        if actual != shared {
            return compatible_path(&candidate, &identity);
        }
        shared_candidate.get_or_insert(candidate);
    }
    let shared_candidate =
        shared_candidate.unwrap_or_else(|| InstalledCandidate::direct(cli.clone()));
    if cli.is_file() {
        if let Ok(path) = compatible_path(&shared_candidate, &identity) {
            return Ok(path);
        }
    }
    let mut command = Command::new("/bin/bash");
    command
        .arg(installer_dir.join("install.sh"))
        .arg("--release")
        .arg(release)
        .arg("--target")
        .arg(host_target())
        .arg("--install-dir")
        .arg(shared_dir)
        .arg("--managed");
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
    command.env("CLINE_INSTALL_BUILD_ID", &identity.build_id);
    // The pinned CLI release owns its build epoch; desktop is built independently.
    command.env_remove("CLINE_INSTALL_BUILD_EPOCH_MS");
    let (mut child, _registration) = cancelled.spawn(&mut command)?;
    let deadline = Instant::now() + Duration::from_secs(600);
    loop {
        if cancelled.is_cancelled() || Instant::now() >= deadline {
            terminate_installer(child.id());
            let _ = child.kill();
            let _ = child.wait();
            return Err(if cancelled.is_cancelled() {
                "runtime installation cancelled during shutdown"
            } else {
                "runtime installation timed out"
            }
            .into());
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
    compatible_path(&shared_candidate, &identity)
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
        };
        let launch =
            compatible_path(&InstalledCandidate::direct(wrapper.clone()), &identity).unwrap();
        assert_eq!(
            launch.launch_env.get("NODE_EXTRA_CA_CERTS").unwrap(),
            "/certificates/company.pem"
        );
        assert!(!launch.launch_env.contains_key("UNRELATED"));
        assert_eq!(
            compatible_path(&InstalledCandidate::direct(wrapper.clone()), &identity)
                .unwrap()
                .executable_path,
            native
        );
        let mismatch = RuntimeIdentity {
            build_id: "other-build".into(),
            core_version: "3.0.0".into(),
        };
        assert!(
            compatible_path(&InstalledCandidate::direct(wrapper.clone()), &mismatch)
                .unwrap_err()
                .contains("no second CLI")
        );
        std::fs::write(&wrapper, "#!/bin/sh\nexit 1").unwrap();
        assert!(
            compatible_path(&InstalledCandidate::direct(wrapper.clone()), &identity)
                .unwrap_err()
                .contains("cannot report")
        );
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
            format!("echo startup-banner\nexport PATH='{}':$PATH\nexport NODE_EXTRA_CA_CERTS=/certificates/company.pem\n", commands.display()),
        )
        .unwrap();
        let native = root.join("native");
        std::fs::write(&native, "binary").unwrap();
        let report = serde_json::json!({"buildId":"sdk-build", "coreVersion":"3.0.0", "compiled":true, "executablePath":native});
        // A fake node outside Finder's PATH demonstrates an env-node wrapper.
        let node = commands.join("node");
        std::fs::write(&node, format!("#!/bin/sh\nprintf '%s\\n' '{}'\n", report)).unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(&cli, "#!/usr/bin/env node\n").unwrap();
        let candidate = login_shell_candidate(
            Command::new("/bin/zsh")
                .env("PATH", "/usr/bin:/bin")
                .env("ZDOTDIR", &root),
        )
        .unwrap()
        .unwrap();
        assert_eq!(candidate.path, cli);
        let identity = RuntimeIdentity {
            build_id: "sdk-build".into(),
            core_version: "3.0.0".into(),
        };
        assert!(probe(
            &cli,
            &HashMap::from([("PATH".into(), "/usr/bin:/bin".into())])
        )
        .is_none());
        let runtime = compatible_path(&candidate, &identity).unwrap();
        assert_eq!(runtime.executable_path, native);
        assert!(runtime.launch_env["PATH"].contains(commands.to_str().unwrap()));
        assert_eq!(
            runtime.launch_env["NODE_EXTRA_CA_CERTS"],
            "/certificates/company.pem"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancelled_install_does_not_start() {
        let root = std::env::temp_dir().join(format!("cline-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("identity.json"),
            r#"{"buildId":"test","coreVersion":"0","buildEpochMs":10}"#,
        )
        .unwrap();
        std::fs::write(root.join("install.sh"), "sleep 30\n").unwrap();
        let cancelled = InstallationControl::default();
        cancelled.cancel();
        let start = Instant::now();
        let result =
            install_with_candidates(&root, &root.join("bin"), "cli-v0.0.43", vec![], &cancelled);
        assert!(result.unwrap_err().contains("cancelled"));
        assert!(start.elapsed() < Duration::from_secs(2));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installs_missing_runtime_using_release_epoch_and_surfaces_failures() {
        let root = std::env::temp_dir().join(format!("cline-install-cold-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let shared = root.join("bin");
        let cli = shared.join("cline");
        std::fs::write(
            root.join("identity.json"),
            r#"{"buildId":"expected-sdk","coreVersion":"3.0.0","buildEpochMs":10}"#,
        )
        .unwrap();
        let source = root.join("native");
        let report = serde_json::json!({"buildId":"expected-sdk", "coreVersion":"3.0.0", "buildEpochMs":20, "compiled":true, "executablePath":cli});
        std::fs::write(
            &source,
            format!("#!/bin/sh\ncat <<'JSON'\n{report}\nJSON\n"),
        )
        .unwrap();
        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(root.join("install.sh"), format!("set -eu\n[ -z \"${{CLINE_INSTALL_BUILD_EPOCH_MS:-}}\" ]\n[ \"$CLINE_INSTALL_BUILD_ID\" = expected-sdk ]\nmkdir -p '{}'\ncp '{}' '{}'\n", shared.display(), source.display(), cli.display())).unwrap();
        let runtime = install_with_candidates(
            &root,
            &shared,
            "cli-v3.0.99",
            vec![],
            &InstallationControl::default(),
        )
        .unwrap();
        assert_eq!(runtime.executable_path, cli);
        std::fs::remove_file(&cli).unwrap();
        std::fs::write(
            root.join("install.sh"),
            "echo 'checksum mismatch' >&2\nexit 1\n",
        )
        .unwrap();
        let error = install_with_candidates(
            &root,
            &shared,
            "cli-v3.0.99",
            vec![],
            &InstallationControl::default(),
        )
        .unwrap_err();
        assert!(error.contains("checksum mismatch"));
        assert!(!cli.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shutdown_terminates_an_active_download_process_group() {
        let root =
            std::env::temp_dir().join(format!("cline-download-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("identity.json"),
            r#"{"buildId":"test","coreVersion":"0"}"#,
        )
        .unwrap();
        let marker = root.join("download.pid");
        std::fs::write(
            root.join("install.sh"),
            format!(
                "sleep 60 &\nprintf '%s\\n' \"$!\" > '{}'\nwait\n",
                marker.display()
            ),
        )
        .unwrap();
        let cancelled = std::sync::Arc::new(InstallationControl::default());
        let flag = cancelled.clone();
        let observed = marker.clone();
        let stopper = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(3);
            while !observed.exists() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            flag.cancel();
        });
        let started = Instant::now();
        let error =
            install_with_candidates(&root, &root.join("bin"), "cli-v3.0.99", vec![], &cancelled)
                .unwrap_err();
        stopper.join().unwrap();
        assert!(error.contains("cancelled"));
        assert!(started.elapsed() < Duration::from_secs(5));
        let pid = std::fs::read_to_string(&marker).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while Command::new("kill")
            .args(["-0", pid.trim()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
        {
            assert!(
                Instant::now() < deadline,
                "download child survived cancellation"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shared_install_is_reused_and_not_overwritten_when_installation_fails() {
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
                "cli-v0.0.43",
                vec![],
                &InstallationControl::default()
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
            "cli-v0.0.43",
            vec![],
            &InstallationControl::default()
        )
        .unwrap_err()
        .contains("Cline runtime installation failed"));
        assert_eq!(std::fs::read(&cli).unwrap(), before);
        std::fs::remove_dir_all(root).unwrap();
    }
}
