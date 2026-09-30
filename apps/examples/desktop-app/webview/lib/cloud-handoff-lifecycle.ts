import {
	buildHandoffWarningToast,
	claimHandoffWarningSurface,
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
	// Source sessions whose completion warning has already been toasted. The
	// completion event and the RPC result both carry the warning; whichever
	// lands first claims it here so the user never sees it twice.
	const surfacedWarnings = new Set<string>();
	// Completions recorded SYNCHRONOUSLY by attempt. Besides bridging reducer
	// lag for event-before-rejection, this makes a trailing/duplicate event a
	// no-op after either completion path has already updated the UI.
	const completions = new Map<string, HandoffCompletionRecord>();
	// Retry payloads belong to the attempt that submitted them. This prevents a
	// delayed completion for A from ever restoring B's edited command or files.
	const retryStates = new Map<
		string,
		{ command?: string; attachments?: File[] }
	>();
	// A duplicate completion event must not retry an in-app recovery open. If
	// the first attempt fails, the reducer and retry registry remain the user's
	// recovery surface instead of an event replay repeatedly stealing focus.
	const targetOpenAttempts = new Set<string>();
	const latestAttempts = new Map<string, string>();
	const acceptedAttempts = new Map<string, string>();
	const attemptOrders = new Map<string, number>();
	const sourceThreadIds = new Map<string, string>();
	let nextAttemptOrder = 0;

	const attemptKey = (sourceSessionId: string, attemptId?: string) =>
		attemptId ?? sourceSessionId;

	// Correlated progress or a successful RPC positively establishes an
	// attempt. Missing progress does not: a later completion can still prove
	// that a newer retry was accepted. The local order lets a positively
	// established newer attempt reject genuinely stale older events.
	const acceptAttempt = (
		sourceSessionId: string,
		attemptId?: string,
	): boolean => {
		if (!attemptId) {
			return !latestAttempts.has(sourceSessionId);
		}
		const order = attemptOrders.get(attemptId) ?? 0;
		const accepted = acceptedAttempts.get(sourceSessionId);
		if (
			accepted &&
			accepted !== attemptId &&
			order < (attemptOrders.get(accepted) ?? 0)
		) {
			return false;
		}
		acceptedAttempts.set(sourceSessionId, attemptId);
		return true;
	};

	const claimWarningToast = (sourceSessionId: string) =>
		claimHandoffWarningSurface(surfacedWarnings, sourceSessionId);
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
		if (
			handoffAttemptId &&
			acceptedAttempts.get(sourceSessionId) !== handoffAttemptId
		)
			return;
		const key = attemptKey(sourceSessionId, handoffAttemptId);
		completions.set(key, completion);
		if (targetOpenAttempts.has(key)) return;
		if (!retry) retryStates.delete(key);
		let opened: boolean | undefined;
		if (openTarget) {
			targetOpenAttempts.add(key);
			const sourceThreadId = sourceThreadIds.get(key);
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
			if (
				handoffAttemptId &&
				acceptedAttempts.get(sourceSessionId) !== handoffAttemptId
			)
				return;
			if (opened) retryStates.delete(key);
		}
		const latestAttempt = latestAttempts.get(sourceSessionId);
		const newerRetry =
			handoffAttemptId && latestAttempt && latestAttempt !== handoffAttemptId
				? retryStates.get(latestAttempt)
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
		if (toast && claimWarningToast(sourceSessionId)) effects.toast(toast);
	};

	return {
		/** Starts a distinct RPC attempt for this source session. */
		onRpcStarted(sourceSessionId: string, sourceThreadId?: string): string {
			const attemptId = crypto.randomUUID();
			attemptOrders.set(attemptId, ++nextAttemptOrder);
			latestAttempts.set(sourceSessionId, attemptId);
			if (sourceThreadId) {
				sourceThreadIds.set(
					attemptKey(sourceSessionId, attemptId),
					sourceThreadId,
				);
			}
			surfacedWarnings.delete(sourceSessionId);
			return attemptId;
		},

		/** Handles a validated `cloud_handoff_progress` event. */
		async onEvent(progress: HandoffProgressEventPayload): Promise<void> {
			const { sourceSessionId, handoffAttemptId } = progress;
			if (!acceptAttempt(sourceSessionId, handoffAttemptId)) return;
			const key = attemptKey(sourceSessionId, handoffAttemptId);
			if (progress.phase === "complete") {
				if (completions.has(key)) return;
				surfaceWarning(sourceSessionId, progress);
				if (progress.sessionId?.trim() && progress.dashboardUrl?.trim()) {
					const saved = retryStates.get(key);
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
			const key = attemptKey(sourceSessionId, ctx.handoffAttemptId);

			const completed = completions.get(key);
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
			// Record the retry payload synchronously: if the authoritative
			// completion lands after this rejection, the reducer replaces the
			// failed entry, and the event path restores the command and
			// attachments from this registry.
			retryStates.set(key, {
				...(nextCommand.trim() ? { command: nextCommand.trim() } : {}),
				...(sourceAttachments.length > 0
					? { attachments: sourceAttachments }
					: {}),
			});
			if (
				ctx.handoffAttemptId &&
				latestAttempts.get(sourceSessionId) !== ctx.handoffAttemptId
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
