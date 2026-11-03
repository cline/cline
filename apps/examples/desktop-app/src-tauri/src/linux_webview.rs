//! WebKitGTK's DMA-BUF renderer does not work on the proprietary NVIDIA
//! driver: the window opens but stays blank while stderr reports
//! `KMS: DRM_IOCTL_MODE_CREATE_DUMB failed: Permission denied` and
//! `Failed to create GBM buffer of size WxH: Permission denied`. The sidecar
//! is healthy; only rendering fails. Tauri's guidance is to set
//! `WEBKIT_DISABLE_DMABUF_RENDERER` before the webview is created:
//! https://v2.tauri.app/develop/debug/linux-graphics/

use std::ffi::OsStr;
use std::path::Path;

const DMABUF_RENDERER_VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
const NVIDIA_MODULE_PATH: &str = "/sys/module/nvidia";

/// Must run before `tauri::Builder` and before any thread is spawned: WebKit
/// reads the variable during initialization, and mutating the environment is
/// only sound while the process is still single-threaded.
pub fn configure_environment() {
    if should_disable_dmabuf_renderer(
        Path::new(NVIDIA_MODULE_PATH).is_dir(),
        std::env::var_os(DMABUF_RENDERER_VAR).as_deref(),
    ) {
        std::env::set_var(DMABUF_RENDERER_VAR, "1");
    }
}

/// Gated on the loaded NVIDIA kernel module rather than arch or session type
/// (the failure reproduces on ARM64/X11 too). Any value the user already set
/// is left alone, including "0" and the empty string, so the documented
/// opt-out (`WEBKIT_DISABLE_DMABUF_RENDERER=0`) keeps working on hybrid-GPU
/// systems where another GPU does the rendering.
fn should_disable_dmabuf_renderer(nvidia_module_loaded: bool, current: Option<&OsStr>) -> bool {
    nvidia_module_loaded && current.is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::ffi::OsStrExt;

    #[test]
    fn disables_the_renderer_when_nvidia_is_loaded_and_the_var_is_unset() {
        assert!(should_disable_dmabuf_renderer(true, None));
    }

    #[test]
    fn leaves_the_renderer_alone_without_the_nvidia_module() {
        assert!(!should_disable_dmabuf_renderer(false, None));
        assert!(!should_disable_dmabuf_renderer(
            false,
            Some(OsStr::new("1"))
        ));
    }

    #[test]
    fn preserves_an_explicit_opt_out() {
        assert!(!should_disable_dmabuf_renderer(true, Some(OsStr::new("0"))));
        assert!(!should_disable_dmabuf_renderer(true, Some(OsStr::new(""))));
    }

    #[test]
    fn preserves_a_non_utf8_value() {
        assert!(!should_disable_dmabuf_renderer(
            true,
            Some(OsStr::from_bytes(b"\xff"))
        ));
    }
}
