//! OS-level power assertions that stop the machine from idle-sleeping while an
//! agent task is running.
//!
//! A suspended machine freezes the app and drops its in-flight network
//! connections, so a long task can fail or stall purely because the user
//! stopped typing. Holding a power assertion for the duration of a run removes
//! the need for a manual `caffeinate -i` (macOS) or a third-party keep-awake
//! utility.
//!
//! Only *system* sleep is prevented here — the display may still turn off,
//! matching `caffeinate -i` and Electron's `prevent-app-suspension` blocker.
//!
//! The public surface is platform-agnostic so the shell can hold one assertion
//! at a time without `cfg` noise at the call site:
//!
//! ```ignore
//! let token = power::acquire()?;
//! power::release(token);
//! ```

/// An acquired power assertion. `None` means no assertion is held.
pub type Assertion = Option<u32>;

/// Whether the shell should be holding a power assertion: the user has left
/// the setting on *and* at least one session is actually running.
pub fn should_hold_assertion(enabled: bool, running_sessions: u32) -> bool {
    enabled && running_sessions > 0
}

// ---------------------------------------------------------------------------
// macOS — IOKit power assertions, the mechanism behind `caffeinate`
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod platform {
    use super::Assertion;

    /// `kIOPMAssertionTypePreventUserIdleSystemSleep`: the machine may not
    /// idle-sleep (the display still can).
    const ASSERTION_TYPE: &str = "PreventUserIdleSystemSleep";
    const ASSERTION_NAME: &str = "Cline is running a task";
    /// `kIOPMAssertionLevelOn`.
    const ASSERTION_LEVEL_ON: u32 = 255;
    /// `kIOReturnSuccess`.
    const RETURN_SUCCESS: i32 = 0;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: core_foundation::string::CFStringRef,
            assertion_level: u32,
            assertion_name: core_foundation::string::CFStringRef,
            assertion_id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(assertion_id: u32) -> i32;
    }

    pub fn acquire() -> Result<Assertion, String> {
        use core_foundation::base::TCFType;
        use core_foundation::string::CFString;

        let assertion_type = CFString::new(ASSERTION_TYPE);
        let assertion_name = CFString::new(ASSERTION_NAME);
        let mut assertion_id: u32 = 0;
        // SAFETY: both CFStrings outlive the call, and `assertion_id` is a
        // valid `u32` the framework writes to on success.
        let result = unsafe {
            IOPMAssertionCreateWithName(
                assertion_type.as_concrete_TypeRef(),
                ASSERTION_LEVEL_ON,
                assertion_name.as_concrete_TypeRef(),
                &mut assertion_id,
            )
        };
        if result == RETURN_SUCCESS {
            Ok(Some(assertion_id))
        } else {
            Err(format!(
                "IOPMAssertionCreateWithName failed with IOReturn {result}"
            ))
        }
    }

    pub fn release(token: u32) {
        // SAFETY: `token` is an ID returned by `acquire`. Releasing an ID the
        // framework no longer knows about returns kIOReturnNotFound instead of
        // corrupting state, so a double release is harmless.
        let result = unsafe { IOPMAssertionRelease(token) };
        if result != RETURN_SUCCESS {
            eprintln!("[keep-awake] IOPMAssertionRelease failed with IOReturn {result}");
        }
    }
}

// ---------------------------------------------------------------------------
// Windows — thread-owned execution state
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod platform {
    use super::Assertion;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::Mutex;
    use std::thread;

    /// Keeps the request in effect until it is explicitly cleared.
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    /// Keeps the system awake; the display is covered by a separate flag.
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

    /// `SetThreadExecutionState` applies to the *calling thread*, so the flag is
    /// owned by a thread of our own that stays parked for as long as sleep must
    /// be prevented. Dropping the sender asks that thread to clear its flag and
    /// exit — the shape Chromium's power save blocker uses. Without a dedicated
    /// owner, an acquire and a release landing on different threads would leave
    /// the machine pinned awake forever.
    static OWNER: Mutex<Option<Sender<()>>> = Mutex::new(None);

    pub fn acquire() -> Result<Assertion, String> {
        let mut owner = OWNER
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if owner.is_some() {
            return Ok(Some(0));
        }

        let (ready_tx, ready_rx) = channel::<bool>();
        let (stop_tx, stop_rx) = channel::<()>();
        thread::Builder::new()
            .name("cline-keep-awake".to_string())
            .spawn(move || {
                use windows_sys::Win32::System::Power::SetThreadExecutionState;

                // SAFETY: no pointers are involved; this only changes
                // kernel-managed execution state for this thread.
                let set =
                    unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) != 0 };
                let _ = ready_tx.send(set);
                if !set {
                    return;
                }
                // Park until `release` drops the sender.
                let _ = stop_rx.recv();
                // SAFETY: as above, and on this same thread, so clearing always
                // applies to the state that was set.
                unsafe {
                    SetThreadExecutionState(ES_CONTINUOUS);
                }
            })
            .map_err(|error| format!("failed to start the keep-awake thread: {error}"))?;

        match ready_rx.recv() {
            Ok(true) => {
                *owner = Some(stop_tx);
                Ok(Some(0))
            }
            Ok(false) => Err("SetThreadExecutionState failed to prevent idle sleep".to_string()),
            Err(_) => Err("the keep-awake thread exited before setting its state".to_string()),
        }
    }

    pub fn release(_token: u32) {
        let mut owner = OWNER
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Dropping the sender ends the owner thread's park; that thread clears
        // the flag itself before exiting.
        *owner = None;
    }
}

// ---------------------------------------------------------------------------
// Linux and anything else — no-op
// ---------------------------------------------------------------------------

/// Linux idle sleep belongs to the desktop environment or systemd and needs a
/// session-bus inhibit, which is not available as a portable syscall. The
/// assertion API stays uniform so callers do not branch on the target.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::Assertion;

    pub fn acquire() -> Result<Assertion, String> {
        Ok(None)
    }

    pub fn release(_token: u32) {}
}

pub use platform::{acquire, release};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_an_assertion_only_while_enabled_and_running() {
        assert!(should_hold_assertion(true, 1));
        assert!(should_hold_assertion(true, 3));
        assert!(!should_hold_assertion(false, 1));
        assert!(!should_hold_assertion(true, 0));
        assert!(!should_hold_assertion(false, 0));
    }
}
