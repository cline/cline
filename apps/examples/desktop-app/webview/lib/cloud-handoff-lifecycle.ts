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
};

type RpcContext = {
	handoffAttemptId?: string;
	nextCommand: string;
	sourceAttachments: File[];
};

export function createHandoffLifecycle(effects: HandoffLifecycleEffects) {
	type Attempt = {
		id: string;
		target?: { sessionId: string; dashboardUrl: string };
		completed: boolean;
	};
	const attempts = new Map<string, Attempt>();
	const current = (source: string, id?: string) => {
		const attempt = attempts.get(source);
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
		});
		const warning = buildHandoffWarningToast(result);
		if (warning) effects.toast(warning);
	};
	return {
		onRpcStarted(sourceSessionId: string): string {
			const id = crypto.randomUUID();
			attempts.set(sourceSessionId, {
				id,
				completed: false,
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
			const raw =
				ctx.error instanceof Error ? ctx.error.message : String(ctx.error);
			const error = parseCloudSessionError(raw);
			const message = humanizeCloudHandoffError(error?.message ?? raw);
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
					...(error?.connectUrl ? { connectUrl: error.connectUrl } : {}),
				});
			}
		},
	};
}

export type HandoffLifecycle = ReturnType<typeof createHandoffLifecycle>;
