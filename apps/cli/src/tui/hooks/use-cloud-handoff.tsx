import { CloudSessionError } from "@cline/core/cloud";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import type {
	CloudHandoffDraft,
	CloudHandoffProgress,
	CloudHandoffResult,
} from "../../runtime/interactive/cloud-handoff";
import { CloudHandoffConfirmContent } from "../components/dialogs/cloud-handoff-confirm";
import { withLoadingDialog } from "../components/dialogs/loading-dialog";
import type { TuiProps } from "../types";

export type CloudHandoffStatus =
	| { kind: "progress"; progress: CloudHandoffProgress }
	| { kind: "complete"; result: CloudHandoffResult }
	| { kind: "failed"; message: string; draft: CloudHandoffDraft };

export function useCloudHandoff(input: {
	prepare: TuiProps["onPrepareCloudHandoff"];
	cloudActive: boolean;
	isLocalBusy: boolean;
	dialog: DialogActions;
	termHeight: number;
}) {
	const [status, setStatus] = useState<CloudHandoffStatus>();
	const inFlight = useRef(false);
	const run = useCallback(
		async (draft: CloudHandoffDraft): Promise<boolean> => {
			if (inFlight.current) return false;
			inFlight.current = true;
			let started = false;
			try {
				const prepare = input.prepare;
				if (!prepare)
					throw new Error("Enable CLINE_CLOUD_SESSIONS=1 to use /cloud.");
				if (input.cloudActive)
					throw new Error("Use /cloud from a local conversation.");
				if (input.isLocalBusy)
					throw new Error(
						"Wait for the current run and queued prompts before using /cloud.",
					);
				const prepared = await withLoadingDialog(
					input.dialog,
					"Capturing the local conversation and Git snapshot…",
					() => prepare(draft),
				);
				const confirmed = await input.dialog.choice<boolean>({
					style: { maxHeight: input.termHeight - 2 },
					content: (ctx: ChoiceContext<boolean>) => (
						<CloudHandoffConfirmContent {...ctx} plan={prepared.git} />
					),
				});
				if (!confirmed) return false;
				started = true;
				setStatus({
					kind: "progress",
					progress: { message: "Preparing cloud handoff…" },
				});
				void prepared
					.start((progress) => setStatus({ kind: "progress", progress }))
					.then(
						(result) => setStatus({ kind: "complete", result }),
						(error) =>
							setStatus({
								kind: "failed",
								message: handoffErrorMessage(error),
								draft,
							}),
					)
					.finally(() => {
						inFlight.current = false;
					});
				return true;
			} catch (error) {
				setStatus({
					kind: "failed",
					message: handoffErrorMessage(error),
					draft,
				});
				return false;
			} finally {
				if (!started) inFlight.current = false;
			}
		},
		[input],
	);
	const retry = async () => {
		if (
			inFlight.current ||
			status?.kind !== "complete" ||
			!status.result.retrySend
		)
			return;
		inFlight.current = true;
		setStatus({
			kind: "progress",
			progress: {
				message: "Sending the saved summary and images to the cloud task…",
				dashboardUrl: status.result.dashboardUrl,
			},
		});
		try {
			const result = await status.result.retrySend();
			setStatus({ kind: "complete", result });
		} catch (error) {
			setStatus({
				kind: "complete",
				result: {
					dashboardUrl: status.result.dashboardUrl,
					warning: handoffErrorMessage(error),
				},
			});
		} finally {
			inFlight.current = false;
		}
	};
	return { run, status, retry, dismiss: () => setStatus(undefined) };
}

function handoffErrorMessage(error: unknown): string {
	if (error instanceof CloudSessionError) return error.detail;
	const message = error instanceof Error ? error.message : String(error);
	const prefix = "CLOUD_SESSION_ERROR:";
	if (!message.startsWith(prefix)) return message;
	try {
		return z
			.object({ message: z.string() })
			.parse(JSON.parse(message.slice(prefix.length))).message;
	} catch {
		return message;
	}
}
