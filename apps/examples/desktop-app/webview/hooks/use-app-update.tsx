"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

export type AppUpdateStatus = {
	state: "idle" | "checking" | "downloading" | "ready" | "error";
	version?: string | null;
	error?: string | null;
};

const POLL_INTERVAL_MS = 30_000;

const IDLE_STATUS: AppUpdateStatus = { state: "idle" };

// Module-scoped store so the toast (page shell) and the sidebar update
// indicator observe the same polled status without extra polling loops.
let currentStatus: AppUpdateStatus = IDLE_STATUS;
const statusListeners = new Set<() => void>();

function statusesEqual(a: AppUpdateStatus, b: AppUpdateStatus): boolean {
	return (
		a.state === b.state &&
		(a.version ?? null) === (b.version ?? null) &&
		(a.error ?? null) === (b.error ?? null)
	);
}

function setUpdateStatus(status: AppUpdateStatus) {
	if (statusesEqual(currentStatus, status)) {
		return;
	}
	currentStatus = status;
	for (const listener of statusListeners) {
		listener();
	}
}

function subscribeToUpdateStatus(listener: () => void): () => void {
	statusListeners.add(listener);
	return () => {
		statusListeners.delete(listener);
	};
}

function getUpdateStatusSnapshot(): AppUpdateStatus {
	return currentStatus;
}

function getUpdateStatusServerSnapshot(): AppUpdateStatus {
	return IDLE_STATUS;
}

/**
 * Read the latest auto-updater status. Reflects the polling performed by
 * `useAppUpdate()` (mounted once in the page shell); stays "idle" in
 * web/sidecar mode where there is no app bundle to update.
 */
export function useAppUpdateStatus(): AppUpdateStatus {
	return useSyncExternalStore(
		subscribeToUpdateStatus,
		getUpdateStatusSnapshot,
		getUpdateStatusServerSnapshot,
	);
}

/**
 * Ask the Rust shell to check for, download, and stage an update right now,
 * instead of waiting for the next background updater interval. Resolves with
 * the resulting updater status ("ready" means an update is staged and a
 * restart will apply it), or null when the check could not run at all
 * (web/sidecar mode, or a bridge failure).
 */
export async function checkForUpdateNow(): Promise<AppUpdateStatus | null> {
	try {
		const status = await desktopClient.invoke<AppUpdateStatus>(
			"check_for_update_now",
		);
		// Keep the shared polled store in sync so the sidebar indicator and
		// update toast reflect an update staged through this path too.
		setUpdateStatus(status);
		return status;
	} catch {
		return null;
	}
}

/**
 * Restart the app so the staged update takes effect. Resolves false (after
 * surfacing a toast) if the restart command fails, so callers can reset
 * pending UI.
 */
export async function restartToApplyUpdate(): Promise<boolean> {
	try {
		await desktopClient.invoke("restart_to_apply_update");
		return true;
	} catch (error) {
		toast({
			variant: "destructive",
			title: "Restart failed",
			description: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

// Module-scoped so a page remount does not re-toast an update the user
// already dismissed while the Rust side still reports it as "ready".
let notifiedVersion: string | null = null;

/**
 * Watches the Tauri shell's auto-updater. Updates are checked, downloaded, and
 * installed in the background by the Rust side; once one is staged this hook
 * surfaces a persistent toast offering a one-click restart into the new
 * version. Dismissing the toast is fine too — the staged update stays
 * reachable from the sidebar update indicator and takes effect on the next
 * launch regardless. No-op in web/sidecar mode where there is no app bundle
 * to update.
 */
export function useAppUpdate() {
	useEffect(() => {
		if (!isTauriAvailable()) {
			return;
		}

		let cancelled = false;

		const poll = async () => {
			let status: AppUpdateStatus;
			try {
				status =
					await desktopClient.invoke<AppUpdateStatus>("get_update_status");
			} catch {
				// Update status is best-effort; ignore transient bridge failures.
				return;
			}
			if (cancelled) {
				return;
			}
			setUpdateStatus(status);
			if (status.state !== "ready" || !status.version) {
				return;
			}
			if (notifiedVersion === status.version) {
				return;
			}
			notifiedVersion = status.version;
			toast({
				title: `Update ready: v${status.version}`,
				description:
					"The new version has been downloaded. Restart now, or later from the update button next to the Cline logo.",
				duration: Number.POSITIVE_INFINITY,
				action: (
					<ToastAction
						altText="Restart now"
						onClick={() => {
							void restartToApplyUpdate();
						}}
					>
						Restart now
					</ToastAction>
				),
			});
		};

		void poll();
		const interval = setInterval(() => {
			void poll();
		}, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);
}
