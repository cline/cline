"use client";

import { useCallback, useEffect, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	checkForUpdateNow,
	restartToApplyUpdate,
} from "@/hooks/use-app-update";
import { desktopClient } from "@/lib/desktop-client";
import {
	describeOutdatedHubSessions,
	resolveHubUpdateRestartDecision,
} from "./hub-update-required-helpers";

type HubBuildMismatchPayload = {
	hubBuildId?: string;
	hubCoreVersion?: string;
	reason?: string;
	activeSessionCount?: number;
	participantClientCount?: number;
};

function mismatchKeyOf(payload: HubBuildMismatchPayload): string {
	return `${payload.reason ?? ""}:${payload.hubBuildId ?? ""}`;
}

type UpdatePhase = "idle" | "updating" | "restarting";

/** Generous deadline: drain wait + graceful retire + fresh daemon startup. */
const HUB_UPGRADE_TIMEOUT_MS = 60_000;

/**
 * Blocking prompt shown when the sidecar reports that the shared Cline Hub
 * does not match this app's build.
 *
 * Two directions, two dialogs:
 * - `build_mismatch` / `unsupported_protocol`: the Hub is newer than this
 *   app. Accepting runs an updater check/download right away and, once an
 *   update is staged, restarts into it so the app and the Hub run the same
 *   version again. Dismissible - the app keeps working over the compatible
 *   wire protocol.
 * - `outdated_hub`: this app is the newer build, and the running Hub was
 *   left in place only because it is still serving other clients' sessions.
 *   Not dismissible: the user chooses between updating the Hub now (which
 *   interrupts those sessions, then relaunches the app onto the fresh Hub)
 *   and quitting the app (the old Hub keeps running for its clients).
 */
export function HubUpdateRequiredDialog() {
	const [mismatch, setMismatch] = useState<HubBuildMismatchPayload | null>(
		null,
	);
	const [dismissedKey, setDismissedKey] = useState<string | null>(null);
	const [phase, setPhase] = useState<UpdatePhase>("idle");
	const [updateHint, setUpdateHint] = useState<string | null>(null);

	useEffect(() => {
		return desktopClient.subscribe("hub_build_mismatch", (payload) => {
			// A null broadcast means the mismatch was resolved (the Hub was
			// upgraded, possibly from another window): close the dialog.
			if (payload === null) {
				setMismatch(null);
				setUpdateHint(null);
				return;
			}
			if (!payload || typeof payload !== "object") {
				return;
			}
			setMismatch(payload as HubBuildMismatchPayload);
			// A new mismatch is a fresh prompt: drop any "no update available"
			// hint left over from a previous dialog so it reopens in its
			// initial state instead of pre-set to "Try again".
			setUpdateHint(null);
		});
	}, []);

	const mismatchKey = mismatch ? mismatchKeyOf(mismatch) : null;

	const handleUpdateAndRestart = useCallback(async () => {
		setPhase("updating");
		setUpdateHint(null);
		const decision = resolveHubUpdateRestartDecision(await checkForUpdateNow());
		if (decision.action === "restart") {
			setPhase("restarting");
			const restarted = await restartToApplyUpdate();
			if (!restarted) {
				setPhase("idle");
			}
			return;
		}
		setUpdateHint(decision.hint);
		setPhase("idle");
	}, []);

	const handleUpgradeHub = useCallback(async () => {
		setPhase("updating");
		setUpdateHint(null);
		try {
			await desktopClient.invoke("hub_upgrade", undefined, {
				timeoutMs: HUB_UPGRADE_TIMEOUT_MS,
			});
		} catch (error) {
			setUpdateHint(
				error instanceof Error && error.message
					? error.message
					: "Updating the Cline Hub failed. Try again, or run 'cline doctor fix' in a terminal.",
			);
			setPhase("idle");
			return;
		}
		setPhase("restarting");
		setMismatch(null);
		// Relaunch into a clean slate attached to the fresh Hub. In plain
		// web/dev mode there is no Tauri shell to relaunch; reloading the page
		// reconnects everything instead.
		try {
			await desktopClient.invoke("relaunch_app");
		} catch {
			window.location.reload();
		}
	}, []);

	const handleQuit = useCallback(async () => {
		try {
			await desktopClient.invoke("quit_app");
		} catch {
			// Plain web/dev mode: no Tauri shell to exit. Best-effort close;
			// browsers only honor this for script-opened windows.
			window.close();
		}
	}, []);

	// This app needs a newer Hub than the one running, and the running one was
	// deliberately left in place because it is serving sessions. Block until
	// the user picks a side: replace the Hub now, or quit and update later.
	if (mismatch?.reason === "outdated_hub") {
		return (
			<AlertDialog open>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cline Hub update required</AlertDialogTitle>
						<AlertDialogDescription>
							Cline needs a newer Cline Hub, but the running one is still
							serving {describeOutdatedHubSessions(mismatch)}.
						</AlertDialogDescription>
						<AlertDialogDescription>
							Update Now stops that Hub and interrupts its sessions. Quit Cline
							closes this app and leaves the Hub running, so you can update
							later.
						</AlertDialogDescription>
						{updateHint ? (
							<AlertDialogDescription>{updateHint}</AlertDialogDescription>
						) : null}
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							disabled={phase !== "idle"}
							onClick={(event) => {
								event.preventDefault();
								void handleQuit();
							}}
						>
							Quit Cline
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={phase !== "idle"}
							onClick={(event) => {
								event.preventDefault();
								void handleUpgradeHub();
							}}
						>
							{phase === "restarting"
								? "Restarting…"
								: phase === "updating"
									? "Updating…"
									: updateHint
										? "Try again"
										: "Update Now"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	}

	const open = mismatchKey !== null && mismatchKey !== dismissedKey;

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen && phase === "idle") {
					setDismissedKey(mismatchKey);
				}
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Cline Hub was updated</AlertDialogTitle>
					<AlertDialogDescription>
						Another Cline installation updated the shared Cline Hub
						{mismatch?.hubCoreVersion
							? ` (core ${mismatch.hubCoreVersion})`
							: ""}
						, and it no longer matches this app. Update and restart Cline to
						stay in sync with the running Hub.
					</AlertDialogDescription>
					{updateHint ? (
						<AlertDialogDescription>{updateHint}</AlertDialogDescription>
					) : null}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={phase !== "idle"}>
						Later
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={phase !== "idle"}
						onClick={(event) => {
							event.preventDefault();
							void handleUpdateAndRestart();
						}}
					>
						{phase === "restarting"
							? "Restarting…"
							: phase === "updating"
								? "Checking for updates…"
								: updateHint
									? "Try again"
									: "Update and restart"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
