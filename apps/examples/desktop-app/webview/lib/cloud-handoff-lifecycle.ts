import {
	buildHandoffWarningToast,
	type HandoffProgressPhase,
	type HandoffResult,
	shouldOpenHandoffInApp,
} from "./cloud-handoff";
import type { CloudHandoffUiAction } from "./cloud-handoff-ui-state";
import {
	humanizeCloudHandoffError,
	parseCloudSessionError,
} from "./cloud-session-error";

/** Coordinates racing completion events and RPC results independently of React rendering. */
export type HandoffLifecycleToast = {
	title: string;
	description?: string;
	variant?: "destructive";
	/** URL for the toast’s "Connect GitHub" action. */
	connectUrl?: string;
};

export type HandoffLifecycleEffects = {
	dispatch: (action: CloudHandoffUiAction) => void;
	toast: (t: HandoffLifecycleToast) => void;
	openSession: (
		sessionId: string,
		opts: {
			silent: true;
			initialPromptDraft?: string;
			initialAttachments?: File[];
			expectedActiveThreadId?: string;
		},
	) => Promise<boolean> | boolean | undefined;
	openExternal: (url: string) => Promise<void>;
};

/** The validated `cloud_handoff_progress` payload (caller checks the shape). */
export type HandoffProgressEventPayload = {
	sourceSessionId: string;
	handoffAttemptId?: string;
	phase: HandoffProgressPhase;
	message?: string;
	dashboardUrl?: string;
	sessionId?: string;
	destination?: "in_app" | "external";
	warning?: string;
	warningKind?: "unqueued" | "unconfirmed";
	undeliveredCommand?: string;
};

export type HandoffCompletionRecord = {
	targetSessionId: string;
	dashboardUrl: string;
	externalPresentation: boolean;
	warningKind?: "unqueued" | "unconfirmed";
};

export type HandoffRpcResolvedContext = {
	handoffAttemptId?: string;
	result: HandoffResult;
	nextCommand: string;
	sourceAttachments: File[];
	/**
	 * Whether the source thread is still the active chat view. Scoped to the
	 * pane that ran the RPC, so it travels per-call instead of living in the
	 * effects; the event path never consults it. Absent means "assume active".
	 */
	isThreadActive?: () => boolean;
};

export type HandoffRpcRejectedContext = {
	silent?: boolean;
	handoffAttemptId?: string;
	error: unknown;
	nextCommand: string;
	sourceAttachments: File[];
	isThreadActive?: () => boolean;
};

export function createHandoffLifecycle(effects: HandoffLifecycleEffects) {
	type Attempt = {
		order: number;
		sourceThreadId?: string;
		completion?: HandoffCompletionRecord;
		retry?: { command?: string; attachments?: File[] };
		openAttempted?: boolean;
	};
	type Source = {
		latest?: Attempt;
		accepted?: Attempt;
		warningShown?: boolean;
	};
	const attempts = new Map<string, Attempt>();
	const sources = new Map<string, Source>();
	let nextAttemptOrder = 0;

	const sourceFor = (sourceSessionId: string): Source => {
		let source = sources.get(sourceSessionId);
		if (!source) {
			source = {};
			sources.set(sourceSessionId, source);
		}
		return source;
	};
	const attemptFor = (sourceSessionId: string, attemptId?: string): Attempt => {
		const key = attemptId ?? sourceSessionId;
		let attempt = attempts.get(key);
		if (!attempt) {
			attempt = { order: 0 };
			attempts.set(key, attempt);
		}
		return attempt;
	};

	// Missing progress is not rejection: only a positively accepted newer
	// attempt can make an older completion stale.
	const acceptAttempt = (
		sourceSessionId: string,
		attemptId?: string,
	): boolean => {
		const source = sourceFor(sourceSessionId);
		if (!attemptId) return !source.latest;
		const attempt = attemptFor(sourceSessionId, attemptId);
		if (source.accepted && attempt.order < source.accepted.order) return false;
		source.accepted = attempt;
		return true;
	};

	const toastFailure = (error: unknown) => {
		const rawError = error instanceof Error ? error.message : String(error);
		const cloudError = parseCloudSessionError(rawError);
		effects.toast({
			title: "Handoff failed",
			description: humanizeCloudHandoffError(cloudError?.message ?? rawError),
			variant: "destructive",
			...(cloudError?.connectUrl ? { connectUrl: cloudError.connectUrl } : {}),
		});
	};

	// Both completion carriers use the same recovery and navigation rules.
	const reconcileCompletion = async (
		sourceSessionId: string,
		handoffAttemptId: string | undefined,
		completion: HandoffCompletionRecord,
		retry: { command?: string; attachments?: File[] } | undefined,
		openTarget: boolean,
	): Promise<boolean | undefined> => {
		const source = sourceFor(sourceSessionId);
		const attempt = attemptFor(sourceSessionId, handoffAttemptId);
		if (handoffAttemptId && source.accepted !== attempt) return;
		attempt.completion = completion;
		if (attempt.openAttempted) return;
		if (!retry) attempt.retry = undefined;
		let opened: boolean | undefined;
		if (openTarget) {
			attempt.openAttempted = true;
			const { sourceThreadId } = attempt;
			opened = Boolean(
				await Promise.resolve()
					.then(() =>
						effects.openSession(completion.targetSessionId, {
							silent: true,
							...(retry?.command ? { initialPromptDraft: retry.command } : {}),
							...(retry?.attachments?.length
								? { initialAttachments: retry.attachments }
								: {}),
							...(sourceThreadId
								? { expectedActiveThreadId: sourceThreadId }
								: {}),
						}),
					)
					.catch(() => false),
			);
			if (handoffAttemptId && source.accepted !== attempt) return;
			if (opened) attempt.retry = undefined;
		}
		const newerRetry =
			handoffAttemptId && source.latest !== attempt
				? source.latest?.retry
				: undefined;
		const retained =
			newerRetry?.command || newerRetry?.attachments?.length
				? newerRetry
				: opened
					? undefined
					: retry;
		effects.dispatch({
			type: "complete",
			sourceSessionId,
			receipt: {
				targetSessionId: completion.targetSessionId,
				dashboardUrl: completion.dashboardUrl,
			},
			externalPresentation: completion.externalPresentation,
			...(retained?.command ? { retryDraft: retained.command } : {}),
			...(retained?.attachments?.length
				? { retryAttachments: retained.attachments }
				: {}),
		});
		return opened;
	};

	const surfaceWarning = (
		sourceSessionId: string,
		warning: Parameters<typeof buildHandoffWarningToast>[0],
	) => {
		const toast = buildHandoffWarningToast(warning);
		const source = sourceFor(sourceSessionId);
		if (toast && !source.warningShown) {
			source.warningShown = true;
			effects.toast(toast);
		}
	};

	return {
		/** Starts a distinct RPC attempt for this source session. */
		onRpcStarted(sourceSessionId: string, sourceThreadId?: string): string {
			const attemptId = crypto.randomUUID();
			const attempt = attemptFor(sourceSessionId, attemptId);
			attempt.order = ++nextAttemptOrder;
			attempt.sourceThreadId = sourceThreadId;
			const source = sourceFor(sourceSessionId);
			source.latest = attempt;
			source.warningShown = false;
			return attemptId;
		},

		/** Handles a validated `cloud_handoff_progress` event. */
		async onEvent(progress: HandoffProgressEventPayload): Promise<void> {
			const { sourceSessionId, handoffAttemptId } = progress;
			if (!acceptAttempt(sourceSessionId, handoffAttemptId)) return;
			const attempt = attemptFor(sourceSessionId, handoffAttemptId);
			if (progress.phase === "complete") {
				if (attempt.completion) return;
				surfaceWarning(sourceSessionId, progress);
				if (progress.sessionId?.trim() && progress.dashboardUrl?.trim()) {
					const saved = attempt.retry;
					const retry =
						progress.warningKind === "unqueued" && saved
							? {
									command: progress.undeliveredCommand ?? saved.command,
									attachments: saved.attachments,
								}
							: undefined;
					await reconcileCompletion(
						sourceSessionId,
						handoffAttemptId,
						{
							targetSessionId: progress.sessionId.trim(),
							dashboardUrl: progress.dashboardUrl,
							externalPresentation: progress.destination === "external",
							warningKind: progress.warningKind,
						},
						retry,
						progress.destination !== "external" &&
							Boolean(retry?.command || retry?.attachments?.length),
					);
				}
				return;
			}
			effects.dispatch({
				type: "progress",
				sourceSessionId,
				phase: progress.phase,
				message: progress.message,
				dashboardUrl: progress.dashboardUrl,
			});
		},

		/** The success tail of the handoff RPC. Throws when the result carries
		 * no cloud session, so the caller's catch routes into onRpcRejected. */
		async onRpcResolved(
			sourceSessionId: string,
			ctx: HandoffRpcResolvedContext,
		): Promise<void> {
			const { result, nextCommand, sourceAttachments } = ctx;
			const targetSessionId = (
				result.outerSessionId ||
				result.sessionId ||
				""
			).trim();
			const dashboardUrl = result.dashboardUrl?.trim();
			if (!targetSessionId || !dashboardUrl) {
				throw new Error("Cloud handoff did not return a cloud session.");
			}
			if (!acceptAttempt(sourceSessionId, ctx.handoffAttemptId)) return;

			const destination = result.destination ?? "in_app";
			const undelivered =
				result.warning && result.warningKind !== "unconfirmed"
					? {
							command: nextCommand.trim() || undefined,
							attachments: sourceAttachments,
						}
					: undefined;
			const openInApp = shouldOpenHandoffInApp(
				destination,
				ctx.isThreadActive?.() ?? true,
			);
			const opened = await reconcileCompletion(
				sourceSessionId,
				ctx.handoffAttemptId,
				{
					targetSessionId,
					dashboardUrl,
					externalPresentation: destination === "external",
					warningKind: result.warningKind,
				},
				undelivered,
				openInApp,
			);
			if (opened === false && (ctx.isThreadActive?.() ?? true)) {
				effects.dispatch({ type: "external", sourceSessionId });
				try {
					await effects.openExternal(dashboardUrl);
					effects.toast({
						title: "Opened handoff in your browser",
						description:
							"The cloud session could not be attached inside Cline.",
					});
				} catch {
					effects.toast({
						title: "Unable to open the browser",
						description:
							"Use the recovery link to open the cloud session manually.",
						variant: "destructive",
					});
				}
			} else if (destination === "external") {
				await effects.openExternal(dashboardUrl).catch(() =>
					effects.toast({
						title: "Cloud handoff complete",
						description: "Use the recovery link to open the cloud session.",
					}),
				);
			} else if (!openInApp) {
				effects.toast({
					title: "Cloud handoff complete",
					description: "The cloud session is ready in your session list.",
				});
			}
			surfaceWarning(sourceSessionId, {
				warning: result.warning,
				warningKind: result.warningKind,
				undeliveredCommand: undelivered?.command,
			});
		},

		/** The failure tail of the handoff RPC (its catch block). */
		async onRpcRejected(
			sourceSessionId: string,
			ctx: HandoffRpcRejectedContext,
		): Promise<void> {
			const { error, nextCommand, sourceAttachments } = ctx;
			const attempt = attemptFor(sourceSessionId, ctx.handoffAttemptId);

			const completed = attempt.completion;
			if (completed) {
				const retry =
					completed.warningKind === "unqueued"
						? {
								command: nextCommand.trim() || undefined,
								attachments: sourceAttachments,
							}
						: undefined;
				await reconcileCompletion(
					sourceSessionId,
					ctx.handoffAttemptId,
					completed,
					retry,
					Boolean(retry?.command || retry?.attachments?.length) &&
						shouldOpenHandoffInApp(
							completed.externalPresentation ? "external" : "in_app",
							ctx.isThreadActive?.() ?? true,
						),
				);
				effects.toast({
					title: "Handoff completed",
					description:
						"The connection dropped while reporting the result, but the cloud session is ready.",
				});
				return;
			}
			attempt.retry = {
				...(nextCommand.trim() ? { command: nextCommand.trim() } : {}),
				...(sourceAttachments.length > 0
					? { attachments: sourceAttachments }
					: {}),
			};
			if (
				ctx.handoffAttemptId &&
				sourceFor(sourceSessionId).latest !== attempt
			) {
				return;
			}
			effects.dispatch({
				type: "failed",
				sourceSessionId,
				retryDraft: nextCommand ? `/cloud ${nextCommand}` : "/cloud",
				retryAttachments: sourceAttachments,
			});
			if (!ctx.silent) toastFailure(error);
		},
	};
}

export type HandoffLifecycle = ReturnType<typeof createHandoffLifecycle>;
