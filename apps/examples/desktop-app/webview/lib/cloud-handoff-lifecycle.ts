import {
	buildHandoffWarningToast,
	type HandoffProgressPhase,
	type HandoffResult,
} from "./cloud-handoff";
import type { CloudHandoffUiAction } from "./cloud-handoff-ui-state";
import {
	humanizeCloudHandoffError,
	parseCloudSessionError,
} from "./cloud-session-error";

type HandoffLifecycleToast = {
	title: string;
	description?: string;
	variant?: "destructive";
	connectUrl?: string;
};

export type HandoffOpenResult = { opened: boolean };
type HandoffLifecycleEffects = {
	dispatch: (action: CloudHandoffUiAction) => void;
	toast: (toast: HandoffLifecycleToast) => void;
};

type HandoffProgressEventPayload = {
	sourceSessionId: string;
	handoffAttemptId?: string;
	phase: HandoffProgressPhase;
	message?: string;
	dashboardUrl?: string;
	sessionId?: string;
	warning?: string;
	warningKind?: "unqueued" | "unconfirmed";
	unsentPrompt?: string;
};

type RpcContext = {
	handoffAttemptId?: string;
	nextCommand: string;
	sourceAttachments: File[];
};

function handoffError(error: unknown) {
	const raw = error instanceof Error ? error.message : String(error);
	const parsed = parseCloudSessionError(raw);
	return {
		message: humanizeCloudHandoffError(parsed?.message ?? raw),
		connectUrl: parsed?.connectUrl,
	};
}

export function createHandoffLifecycle(effects: HandoffLifecycleEffects) {
	type Attempt = {
		id: string;
		target?: { sessionId: string; dashboardUrl: string };
		completed: boolean;
		attachments: File[];
	};
	const sources = new Map<string, { attempt?: Attempt; preparing: boolean }>();
	const current = (source: string, id?: string) => {
		const attempt = sources.get(source)?.attempt;
		return attempt && attempt.id === id ? attempt : undefined;
	};
	const complete = (
		source: string,
		attempt: Attempt,
		result: HandoffResult,
	) => {
		if (attempt.completed) return;
		attempt.completed = true;
		effects.dispatch({
			type: "complete",
			sourceSessionId: source,
			sessionId: result.sessionId,
			dashboardUrl: result.dashboardUrl,
			message: result.warning,
			unsentDraft:
				result.warningKind === "unqueued" && result.unsentPrompt
					? { text: result.unsentPrompt, attachments: attempt.attachments }
					: undefined,
		});
		attempt.attachments = [];
		const warning = buildHandoffWarningToast(result);
		if (warning) effects.toast(warning);
	};
	return {
		getCompletedAttemptId(sourceSessionId: string): string | undefined {
			const attempt = sources.get(sourceSessionId)?.attempt;
			return attempt?.completed ? attempt.id : undefined;
		},
		onRecovered(
			sourceSessionId: string,
			recovered: { handoffAttemptId: string; result: HandoffResult },
		): void {
			let attempt = current(sourceSessionId, recovered.handoffAttemptId);
			let result = recovered.result;
			if (!attempt) {
				attempt = {
					id: recovered.handoffAttemptId,
					completed: false,
					attachments: [],
				};
				sources.set(sourceSessionId, { attempt, preparing: false });
				if (result.unsentPrompt)
					result = {
						...result,
						warning:
							`${result.warning ?? ""} Reattach any images from the previous window before sending.`.trim(),
					};
			}
			complete(sourceSessionId, attempt, result);
		},
		onPreparationStarted(sourceSessionId: string): boolean {
			const source = sources.get(sourceSessionId);
			if (source?.preparing) return false;
			sources.set(sourceSessionId, { ...source, preparing: true });
			return true;
		},
		onPreparationRejected(
			sourceSessionId: string,
			ctx: Omit<RpcContext, "handoffAttemptId"> & {
				error: unknown;
				silent?: boolean;
			},
		): void {
			const source = sources.get(sourceSessionId);
			if (source) source.preparing = false;
			const { message, connectUrl } = handoffError(ctx.error);
			effects.dispatch({
				type: "preparation_failed",
				sourceSessionId,
				message,
				retryDraft: ctx.nextCommand,
				retryAttachments: ctx.sourceAttachments,
			});
			if (!ctx.silent)
				effects.toast({
					title: "Cloud preparation failed",
					description: message,
					variant: "destructive",
					connectUrl,
				});
		},
		onRpcStarted(sourceSessionId: string, attachments: File[]): string {
			const id = crypto.randomUUID();
			sources.set(sourceSessionId, {
				preparing: false,
				attempt: { id, completed: false, attachments },
			});
			return id;
		},
		async onEvent(event: HandoffProgressEventPayload): Promise<void> {
			const attempt = current(event.sourceSessionId, event.handoffAttemptId);
			if (!attempt || attempt.completed) return;
			if (event.sessionId && event.dashboardUrl) {
				attempt.target = {
					sessionId: event.sessionId,
					dashboardUrl: event.dashboardUrl,
				};
				if (event.phase === "complete") {
					complete(event.sourceSessionId, attempt, {
						...event,
						sessionId: event.sessionId,
						dashboardUrl: event.dashboardUrl,
					});
					return;
				}
			}
			if (event.phase !== "complete")
				effects.dispatch({
					type: "progress",
					sourceSessionId: event.sourceSessionId,
					phase: event.phase,
					message: event.message,
					dashboardUrl: event.dashboardUrl,
					sessionId: event.sessionId,
				});
		},
		async onRpcResolved(
			sourceSessionId: string,
			ctx: { handoffAttemptId?: string; result: HandoffResult },
		): Promise<void> {
			const attempt = current(sourceSessionId, ctx.handoffAttemptId);
			if (!attempt) return;
			if (!ctx.result.sessionId?.trim() || !ctx.result.dashboardUrl?.trim())
				throw new Error("Cloud task creation did not return a session.");
			complete(sourceSessionId, attempt, ctx.result);
		},
		async onRpcRejected(
			sourceSessionId: string,
			ctx: RpcContext & { error: unknown; silent?: boolean },
		): Promise<void> {
			const attempt = current(sourceSessionId, ctx.handoffAttemptId);
			if (!attempt || attempt.completed) return;
			if (attempt.target) {
				effects.dispatch({
					type: "complete",
					sourceSessionId,
					...attempt.target,
					message:
						"Delivery could not be confirmed. Check the cloud task before sending again.",
				});
				effects.toast({
					title: "Check the cloud task",
					description: `Delivery could not be confirmed. Open ${attempt.target.dashboardUrl} before sending again.`,
				});
				return;
			}
			const { message, connectUrl } = handoffError(ctx.error);
			effects.dispatch({
				type: "failed",
				sourceSessionId,
				message,
				retryDraft: ctx.nextCommand,
				retryAttachments: ctx.sourceAttachments,
			});
			if (!ctx.silent) {
				effects.toast({
					title: "Handoff failed",
					description: message,
					variant: "destructive",
					connectUrl,
				});
			}
		},
	};
}

export type HandoffLifecycle = ReturnType<typeof createHandoffLifecycle>;
