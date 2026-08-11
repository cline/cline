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
import { restartToApplyUpdate } from "@/hooks/use-app-update";
import { desktopClient } from "@/lib/desktop-client";

type HubBuildMismatchPayload = {
	hubBuildId?: string;
	hubCoreVersion?: string;
	reason?: string;
};

function mismatchKeyOf(payload: HubBuildMismatchPayload): string {
	return `${payload.reason ?? ""}:${payload.hubBuildId ?? ""}`;
}

/**
 * Blocking prompt shown when the sidecar reports that another Cline
 * installation (for example an updated CLI) replaced the shared Cline Hub
 * with a different build. Restarting relaunches the app - applying any
 * staged auto-update - so the app and the Hub run the same version again.
 */
export function HubUpdateRequiredDialog() {
	const [mismatch, setMismatch] = useState<HubBuildMismatchPayload | null>(
		null,
	);
	const [dismissedKey, setDismissedKey] = useState<string | null>(null);
	const [restarting, setRestarting] = useState(false);

	useEffect(() => {
		return desktopClient.subscribe("hub_build_mismatch", (payload) => {
			if (!payload || typeof payload !== "object") {
				return;
			}
			setMismatch(payload as HubBuildMismatchPayload);
		});
	}, []);

	const mismatchKey = mismatch ? mismatchKeyOf(mismatch) : null;
	const open = mismatchKey !== null && mismatchKey !== dismissedKey;

	const handleRestart = useCallback(async () => {
		setRestarting(true);
		const restarted = await restartToApplyUpdate();
		if (!restarted) {
			setRestarting(false);
		}
	}, []);

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen && !restarting) {
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
						, and it no longer matches this app. Update and restart Cline Code
						to stay in sync with the running Hub.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={restarting}>Later</AlertDialogCancel>
					<AlertDialogAction
						disabled={restarting}
						onClick={(event) => {
							event.preventDefault();
							void handleRestart();
						}}
					>
						{restarting ? "Restarting…" : "Update and restart"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
