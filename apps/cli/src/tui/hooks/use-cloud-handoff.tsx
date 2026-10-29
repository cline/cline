import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import { useRef, useState, useSyncExternalStore } from "react";
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
	| {
			kind: "failed";
			message: string;
			connectUrl?: string;
			draft: CloudHandoffDraft;
	  };

const noSession = {
	getId: () => "",
	subscribe: () => () => {},
};

export function useCloudHandoff(input: {
	prepare: TuiProps["onPrepareCloudHandoff"];
	activeSession: TuiProps["activeSession"];
	cloudActive: boolean;
	isLocalBusy: boolean;
	dialog: DialogActions;
	termHeight: number;
	showError: (message: string) => void;
}) {
	const activeSession = input.activeSession ?? noSession;
	const sourceId = useSyncExternalStore(
		activeSession.subscribe,
		activeSession.getId,
	);
	const [statuses, setStatuses] = useState<
		Record<string, CloudHandoffStatus & { hidden?: true }>
	>({});
	const sourceStatus = statuses[sourceId];
	const status = input.cloudActive ? undefined : sourceStatus;
	const canHide =
		!!status &&
		!status.hidden &&
		((status.kind === "complete" && !status.result.retrySend) ||
			(status.kind === "failed" &&
				!status.draft.instruction.trim() &&
				status.draft.images.length === 0));
	const inFlight = useRef<symbol | undefined>(undefined);
	const begin = (sourceId: string) => {
		const attempt = Symbol();
		inFlight.current = attempt;
		return {
			isCurrent: () => inFlight.current === attempt,
			setStatus: (next: CloudHandoffStatus) => {
				if (inFlight.current === attempt)
					setStatuses((current) => ({ ...current, [sourceId]: next }));
			},
			finish: () => {
				if (inFlight.current === attempt) inFlight.current = undefined;
			},
		};
	};
	const run = async (draft: CloudHandoffDraft): Promise<boolean> => {
		if (input.cloudActive) {
			input.showError("Use /cloud from a local conversation.");
			return false;
		}
		if (inFlight.current) {
			input.showError("Wait for the current cloud handoff to finish.");
			return false;
		}
		const sourceId = activeSession.getId();
		if (!sourceId) {
			input.showError("Start a local conversation before using /cloud.");
			return false;
		}
		const attempt = begin(sourceId);
		let started = false;
		try {
			const prepare = input.prepare;
			if (!prepare)
				throw new Error("Enable CLINE_CLOUD_SESSIONS=1 to use /cloud.");
			if (input.isLocalBusy)
				throw new Error(
					"Wait for the current run and queued prompts before using /cloud.",
				);
			const prepared = await withLoadingDialog(
				input.dialog,
				"Capturing the local conversation and Git snapshot…",
				() => prepare(draft),
			);
			if (!attempt.isCurrent() || activeSession.getId() !== sourceId)
				return false;
			const confirmed = await input.dialog.choice<boolean>({
				style: { maxHeight: input.termHeight - 2 },
				content: (ctx: ChoiceContext<boolean>) => (
					<CloudHandoffConfirmContent {...ctx} plan={prepared.git} />
				),
			});
			if (
				!confirmed ||
				!attempt.isCurrent() ||
				activeSession.getId() !== sourceId
			)
				return false;
			started = true;
			attempt.setStatus({
				kind: "progress",
				progress: { message: "Preparing cloud handoff…" },
			});
			void prepared
				.start((progress) => attempt.setStatus({ kind: "progress", progress }))
				.then(
					(result) => attempt.setStatus({ kind: "complete", result }),
					(error) =>
						attempt.setStatus({
							kind: "failed",
							...handoffError(error),
							draft,
						}),
				)
				.finally(attempt.finish);
			return true;
		} catch (error) {
			if (attempt.isCurrent()) {
				const failure = handoffError(error);
				if (statuses[sourceId]?.kind === "complete") {
					if (activeSession.getId() === sourceId)
						input.showError(failure.message);
				} else attempt.setStatus({ kind: "failed", ...failure, draft });
			}
			return false;
		} finally {
			if (!started) attempt.finish();
		}
	};
	const retry = async () => {
		if (
			inFlight.current ||
			activeSession.getId() !== sourceId ||
			status?.kind !== "complete" ||
			!status.result.retrySend
		)
			return;
		const attempt = begin(sourceId);
		attempt.setStatus({
			kind: "progress",
			progress: {
				message: "Sending the saved summary and images to the cloud task…",
				dashboardUrl: status.result.dashboardUrl,
			},
		});
		try {
			const result = await status.result.retrySend();
			attempt.setStatus({ kind: "complete", result });
		} catch (error) {
			attempt.setStatus({
				kind: "complete",
				result: {
					sessionId: status.result.sessionId,
					dashboardUrl: status.result.dashboardUrl,
					warning: handoffError(error).message,
				},
			});
		} finally {
			attempt.finish();
		}
	};
	return {
		run,
		sourceId,
		status,
		notice: status?.hidden ? undefined : status,
		targetSessionId:
			sourceStatus?.kind === "complete"
				? sourceStatus.result.sessionId
				: undefined,
		canHide,
		retry,
		hide: () => {
			if (activeSession.getId() !== sourceId || !canHide) return;
			setStatuses((current) => {
				const entry = current[sourceId];
				return entry === status
					? { ...current, [sourceId]: { ...entry, hidden: true } }
					: current;
			});
		},
		reset: () => {
			inFlight.current = undefined;
			setStatuses({});
		},
	};
}

function handoffError(error: unknown): {
	message: string;
	connectUrl?: string;
} {
	const message = error instanceof Error ? error.message : String(error);
	const prefix = "CLOUD_SESSION_ERROR:";
	if (!message.startsWith(prefix)) return { message };
	try {
		const parsed = z
			.object({
				code: z.string(),
				message: z.string(),
				connectUrl: z.string().optional(),
			})
			.parse(JSON.parse(message.slice(prefix.length)));
		const connectUrl = z.string().url().safeParse(parsed.connectUrl?.trim());
		return {
			message: parsed.message,
			...(parsed.code === "github_not_connected" &&
			connectUrl.success &&
			/^https?:\/\//i.test(connectUrl.data)
				? { connectUrl: connectUrl.data }
				: {}),
		};
	} catch {
		return { message };
	}
}
