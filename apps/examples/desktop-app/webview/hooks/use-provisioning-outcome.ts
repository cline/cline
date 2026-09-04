import { useEffect, useRef } from "react";
import { humanizeCloudSessionError } from "@/lib/cloud-session-error";
import { desktopClient } from "@/lib/desktop-client";

export type CloudProvisioningPhase =
	| "provisioning"
	| "cloning_repo"
	| "agent_starting"
	| "ready"
	| "failed";

export type CloudProvisioningOutcome =
	| {
			status: "provisioning";
			phase?: CloudProvisioningPhase;
	  }
	| { status: "ready"; sessionId: string }
	| { status: "failed"; message: string };

export const PROVISIONING_OUTCOME_POLL_MS = 1_500;
export const PROVISIONING_UNKNOWN_GIVE_UP_POLLS = 8;
export const PROVISIONING_OPEN_GIVE_UP_ATTEMPTS = 5;

export function useProvisioningOutcome(options: {
	placeholderId: string | undefined;
	onOpenReady: (sessionId: string) => Promise<boolean>;
	onResolved: () => void;
	onError: (message: string) => void;
	onPhase?: (phase: CloudProvisioningPhase | undefined) => void;
}): void {
	const callbacksRef = useRef(options);
	callbacksRef.current = options;

	useEffect(() => {
		if (!options.placeholderId) return;
		const placeholderId = options.placeholderId;
		let cancelled = false;
		let retryTimer: number | undefined;
		let unknownPolls = 0;
		let failedOpens = 0;

		async function checkOutcome() {
			try {
				const outcome =
					await desktopClient.invoke<CloudProvisioningOutcome | null>(
						"get_cloud_provisioning_outcome",
						{ placeholderId },
					);
				if (cancelled) return;
				if (outcome?.status === "ready") {
					const opened = await callbacksRef.current.onOpenReady(
						outcome.sessionId,
					);
					if (cancelled) return;
					if (opened) {
						callbacksRef.current.onResolved();
						return;
					}
					failedOpens += 1;
					if (failedOpens >= PROVISIONING_OPEN_GIVE_UP_ATTEMPTS) {
						callbacksRef.current.onError(
							"The cloud session was created but could not be opened automatically. Open it from the sidebar.",
						);
						return;
					}
				} else if (outcome?.status === "failed") {
					callbacksRef.current.onError(
						humanizeCloudSessionError(outcome.message) ||
							"The cloud session could not be started.",
					);
					return;
				} else if (outcome === null) {
					unknownPolls += 1;
					if (unknownPolls >= PROVISIONING_UNKNOWN_GIVE_UP_POLLS) {
						callbacksRef.current.onError(
							"This session's provisioning state was lost. Check the sidebar for the session, or start a new one.",
						);
						return;
					}
				} else {
					unknownPolls = 0;
					callbacksRef.current.onPhase?.(outcome?.phase);
				}
			} catch {
				// Keep polling through a temporary sidecar interruption.
			}
			if (!cancelled) {
				retryTimer = window.setTimeout(
					checkOutcome,
					PROVISIONING_OUTCOME_POLL_MS,
				);
			}
		}

		void checkOutcome();
		return () => {
			cancelled = true;
			if (retryTimer !== undefined) window.clearTimeout(retryTimer);
		};
	}, [options.placeholderId]);
}
