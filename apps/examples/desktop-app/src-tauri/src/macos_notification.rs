use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use tauri::AppHandle;

const DEV_APP_DIRECTORY: &str = "notification-identity";
const DEV_BUNDLE_NAME: &str = "Cline Code.app";
const LAUNCH_SERVICES_REGISTER: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

static CONFIGURATION: OnceLock<Result<(), String>> = OnceLock::new();

pub fn configure(app: &AppHandle) -> Result<(), String> {
    CONFIGURATION
        .get_or_init(|| {
            let identifier = app.config().identifier.as_str();
            if tauri::is_dev() {
                register_dev_application(app)?;
            }

            notify_rust::set_application(identifier).map_err(|error| {
                format!("failed configuring macOS notification application {identifier}: {error}")
            })
        })
        .clone()
}

fn register_dev_application(app: &AppHandle) -> Result<PathBuf, String> {
    let executable = tauri::utils::platform::current_exe()
        .map_err(|error| format!("failed resolving the app executable: {error}"))?;
    let icon = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/icon.icns");
    let app_name = app
        .config()
        .product_name
        .as_deref()
        .ok_or_else(|| "the development app has no product name".to_string())?;
    let bundle =
        create_dev_application_bundle(&executable, &icon, &app.config().identifier, app_name)?;
    let output = Command::new(LAUNCH_SERVICES_REGISTER)
        .arg("-lint")
        .arg("-f")
        .arg(&bundle)
        .output()
        .map_err(|error| format!("failed starting Launch Services registration: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "Launch Services registration failed with status {}",
                output.status
            )
        } else {
            format!("Launch Services registration failed: {stderr}")
        });
    }
    Ok(bundle)
}

fn create_dev_application_bundle(
    executable: &Path,
    icon: &Path,
    identifier: &str,
    app_name: &str,
) -> Result<PathBuf, String> {
    let executable_directory = executable
        .parent()
        .ok_or_else(|| "the app executable has no parent directory".to_string())?;
    let bundle = executable_directory
        .join(DEV_APP_DIRECTORY)
        .join(DEV_BUNDLE_NAME);
    let contents = bundle.join("Contents");
    let macos = contents.join("MacOS");
    let resources = contents.join("Resources");
    fs::create_dir_all(&macos)
        .and_then(|_| fs::create_dir_all(&resources))
        .map_err(|error| format!("failed creating development app bundle: {error}"))?;

    let bundled_executable = macos.join("cline-app");
    match fs::symlink_metadata(&bundled_executable) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let current_target = fs::read_link(&bundled_executable).map_err(|error| {
                format!("failed reading development app executable link: {error}")
            })?;
            if current_target != executable {
                fs::remove_file(&bundled_executable).map_err(|error| {
                    format!("failed replacing development app executable link: {error}")
                })?;
                symlink(executable, &bundled_executable).map_err(|error| {
                    format!("failed linking the development app executable: {error}")
                })?;
            }
        }
        Ok(_) => {
            return Err(format!(
                "development app executable path is not a symlink: {}",
                bundled_executable.display()
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            symlink(executable, &bundled_executable).map_err(|error| {
                format!("failed linking the development app executable: {error}")
            })?;
        }
        Err(error) => {
            return Err(format!(
                "failed inspecting the development app executable link: {error}"
            ));
        }
    }

    fs::copy(icon, resources.join("icon.icns"))
        .map_err(|error| format!("failed copying the development app icon: {error}"))?;
    fs::write(
        contents.join("Info.plist"),
        dev_info_plist(identifier, app_name),
    )
    .map_err(|error| format!("failed writing the development app bundle metadata: {error}"))?;

    Ok(bundle)
}

fn dev_info_plist(identifier: &str, app_name: &str) -> String {
    let identifier = escape_plist_string(identifier);
    let app_name = escape_plist_string(app_name);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>{app_name}</string>
  <key>CFBundleExecutable</key>
  <string>cline-app</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>{identifier}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>{app_name}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.0.0</string>
  <key>CFBundleVersion</key>
  <string>0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
"#
    )
}

fn escape_plist_string(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock must be after the Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "cline-notification-identity-test-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("test directory should be created");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn creates_a_registered_application_shape_for_development() {
        let test_directory = TestDirectory::new();
        let executable = test_directory.0.join("target/debug/cline-app");
        let icon = test_directory.0.join("icon.icns");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(&executable, b"test executable").unwrap();
        fs::write(&icon, b"test icon").unwrap();

        let bundle = create_dev_application_bundle(
            &executable,
            &icon,
            "bot.cline.app.dev",
            "Cline Code Dev",
        )
        .unwrap();
        let plist = fs::read_to_string(bundle.join("Contents/Info.plist")).unwrap();

        assert!(plist.contains("<string>bot.cline.app.dev</string>"));
        assert!(plist.contains("<string>Cline Code Dev</string>"));
        assert_eq!(
            fs::read_link(bundle.join("Contents/MacOS/cline-app")).unwrap(),
            executable
        );
        assert_eq!(
            fs::read(bundle.join("Contents/Resources/icon.icns")).unwrap(),
            b"test icon"
        );
    }
}
