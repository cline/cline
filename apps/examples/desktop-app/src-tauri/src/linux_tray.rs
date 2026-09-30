//! Closing the main window hides it to the tray, and the tray's Quit item is
//! the only way to quit. On Linux the tray is a StatusNotifierItem, which is
//! only shown by a StatusNotifier host (KDE, XFCE, GNOME with the AppIndicator
//! extension). Stock GNOME (Fedora Workstation, Debian) has no host, so
//! closing the window left the app running with no icon and no way to quit
//! but `kill`. Creating the tray icon cannot detect this: tray-icon's GTK
//! backend only registers the indicator and reports success whether or not
//! anything is listening. What can is the session bus: a host announces
//! itself to `org.kde.StatusNotifierWatcher`, which exposes it as the
//! `IsStatusNotifierHostRegistered` property.

use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const WATCHER_BUS_NAME: &str = "org.kde.StatusNotifierWatcher";
const WATCHER_OBJECT_PATH: &str = "/StatusNotifierWatcher";
const WATCHER_INTERFACE: &str = "org.kde.StatusNotifierWatcher";
const HOST_REGISTERED_PROPERTY: &str = "IsStatusNotifierHostRegistered";
/// The probe runs on the GTK main thread from the close handler, so it must
/// not stall it: a healthy bus answers one property read in a few
/// milliseconds, and a bus that takes longer is treated as having no host.
const PROBE_TIMEOUT: Duration = Duration::from_millis(250);

/// Whether a StatusNotifier host is registered on the session bus right now.
///
/// Probed at close time rather than once at startup so that a host that
/// appears mid-session (the user enables the GNOME extension) is honored, and
/// one that disappears (the panel crashes) is too. No session bus, no
/// watcher on it, a `false` property, or a timeout all mean "no host".
pub fn status_notifier_host_registered() -> bool {
    host_registered_within(read_host_registered_property, PROBE_TIMEOUT)
}

fn read_host_registered_property() -> Result<bool, String> {
    let connection = zbus::blocking::Connection::session().map_err(|error| error.to_string())?;
    // A single read: skip the property cache, which would issue a GetAll and
    // subscribe to PropertiesChanged for a proxy that is dropped right away.
    let proxy = zbus::blocking::proxy::Builder::<zbus::blocking::Proxy<'_>>::new(&connection)
        .destination(WATCHER_BUS_NAME)
        .and_then(|builder| builder.path(WATCHER_OBJECT_PATH))
        .and_then(|builder| builder.interface(WATCHER_INTERFACE))
        .map_err(|error| error.to_string())?
        .cache_properties(zbus::proxy::CacheProperties::No)
        .build()
        .map_err(|error| error.to_string())?;
    proxy
        .get_property::<bool>(HOST_REGISTERED_PROPERTY)
        .map_err(|error| error.to_string())
}

/// Runs `probe` off the calling thread and decides from whatever it reports
/// within `timeout`. A probe that overruns is left to finish on its own.
fn host_registered_within(
    probe: impl FnOnce() -> Result<bool, String> + Send + 'static,
    timeout: Duration,
) -> bool {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(probe());
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(registered)) => registered,
        Ok(Err(reason)) => {
            eprintln!("[tray] no StatusNotifier host: {reason}");
            false
        }
        Err(_) => {
            eprintln!("[tray] no StatusNotifier host: probe timed out");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registered_host_is_reported() {
        assert!(host_registered_within(|| Ok(true), Duration::from_secs(1)));
    }

    #[test]
    fn watcher_without_a_host_means_no_host() {
        assert!(!host_registered_within(
            || Ok(false),
            Duration::from_secs(1)
        ));
    }

    #[test]
    fn missing_bus_or_watcher_means_no_host() {
        assert!(!host_registered_within(
            || Err("Connection refused".to_string()),
            Duration::from_secs(1)
        ));
    }

    #[test]
    fn slow_probe_means_no_host() {
        assert!(!host_registered_within(
            || {
                thread::sleep(Duration::from_secs(5));
                Ok(true)
            },
            Duration::from_millis(50)
        ));
    }
}
