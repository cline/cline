"use client";

import { useEffect } from "react";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

export type AppUpdateStatus = {
	state: "idle" | "checking" | "downloading" | "ready" | "error";
	version?: string | null;
	error?: string | null;
};

const POLL_INTERVAL_MS = 30_000;

/**
 * Watches the Tauri shell's auto-updater. Updates are checked, downloaded, and
 * installed in the background by the Rust side; once one is staged this hook
 * surfaces a persistent toast offering a one-click restart into the new
 * version. Ignoring the toast is fine too — the staged update takes effect on
 * the next launch. No-op in web/sidecar mode where there is no app bundle to
 * update.
 */
export function useAppUpdate() {
	useEffect(() => {
		if (!isTauriAvailable()) {
			return;
		}

		let cancelled = false;
		let notifiedVersion: string | null = null;

		const poll = async () => {
			let status: AppUpdateStatus;
			try {
				status =
					await desktopClient.invoke<AppUpdateStatus>("get_update_status");
			} catch {
				// Update status is best-effort; ignore transient bridge failures.
				return;
			}
			if (cancelled || status.state !== "ready" || !status.version) {
				return;
			}
			if (notifiedVersion === status.version) {
				return;
			}
			notifiedVersion = status.version;
			toast({
				title: `Update ready: v${status.version}`,
				description:
					"The new version has been downloaded and will be used the next time the app starts.",
				duration: Number.POSITIVE_INFINITY,
				action: (
					<ToastAction
						altText="Restart now"
						onClick={() => {
							void desktopClient.invoke("restart_to_apply_update");
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
