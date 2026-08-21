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
import { resolveHubUpdateRestartDecision } from "./hub-update-required-helpers";

type HubBuildMismatchPayload = {
	hubBuildId?: string;
	hubCoreVersion?: string;
	reason?: string;
};

function mismatchKeyOf(payload: HubBuildMismatchPayload): string {
	return `${payload.reason ?? ""}:${payload.hubBuildId ?? ""}`;
}

type UpdatePhase = "idle" | "updating" | "restarting";

/**
 * Blocking prompt shown when the sidecar reports that another Cline
 * installation (for example an updated CLI) replaced the shared Cline Hub
 * with a different build. Accepting runs an updater check/download right
 * away and, once an update is staged, restarts into it so the app and the
 * Hub run the same version again. If nothing is staged (no release published
 * yet, or the check failed), the dialog explains why instead of restarting
 * into the same version and immediately re-prompting.
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
	const open = mismatchKey !== null && mismatchKey !== dismissedKey;

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

	// `outdated_hub` is purely informational: this app is already the newer
	// build, nothing is asked of the user, and the Hub is replaced on its own
	// once its sessions end. Interrupting with a modal to say "ignore me"
	// helps nobody, so that reason renders nothing.
	if (mismatch?.reason === "outdated_hub") {
		return null;
	}

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
