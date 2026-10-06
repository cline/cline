use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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

pub fn install(installer_dir: &Path, cache_dir: &Path, release: &str) -> Result<PathBuf, String> {
    let install_dir = cache_dir.join(host_target());
    let cli = install_dir.join(if cfg!(windows) { "cline.exe" } else { "cline" });
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
            .arg(&install_dir)
            .arg("-NoModifyPath");
    } else {
        command = Command::new("/bin/bash");
        command
            .arg(installer_dir.join("install.sh"))
            .arg("--release")
            .arg(release)
            .arg("--target")
            .arg(host_target())
            .arg("--install-dir")
            .arg(&install_dir)
            .arg("--no-modify-path");
    }
    command.stdin(Stdio::null());
    super::hide_console_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("failed to run CLI installer: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Cline runtime installation failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if !cli.is_file() {
        return Err(format!("CLI installer did not create {}", cli.display()));
    }
    Ok(cli)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn installer_handles_paths_with_spaces_and_propagates_failure() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("cline runtime {stamp}"));
        std::fs::create_dir_all(&root).unwrap();
        let script = root.join("install.sh");
        std::fs::write(
            &script,
            r#"set -eu
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-dir) directory="$2"; shift 2 ;;
    --release|--target) shift 2 ;;
    --no-modify-path) shift ;;
    *) exit 9 ;;
  esac
done
mkdir -p "$directory"
cp /usr/bin/true "$directory/cline"
"#,
        )
        .unwrap();
        let cli = install(&root, &root.join("cache"), "desktop-v0.0.43").unwrap();
        assert!(cli.is_file());
        assert!(cli.starts_with(root.join("cache")));
        std::fs::write(&script, "echo 'checksum mismatch' >&2; exit 7").unwrap();
        let error = install(&root, &root.join("failure"), "desktop-v0.0.43").unwrap_err();
        assert!(error.contains("checksum mismatch"));
        assert!(!root.join("failure").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
