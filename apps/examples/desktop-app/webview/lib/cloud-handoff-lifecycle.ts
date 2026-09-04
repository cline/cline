import {
	buildHandoffWarningToast,
	claimHandoffWarningSurface,
	type HandoffProgressPhase,
	type HandoffReceipt,
	type HandoffResult,
	shouldOpenHandoffInApp,
} from "./cloud-handoff";
import type {
	CloudHandoffUiAction,
	PendingHandoffPrompt,
} from "./cloud-handoff-ui-state";
import {
	humanizeCloudHandoffError,
	parseCloudSessionError,
} from "./cloud-session-error";

/**
 * Pure coordinator for handoff completion, failure, and follow-up restoration.
 *
 * The `cloud_handoff_progress` completion event and the handoff RPC result
 * race each other in every direction (event-before-rejection,
 * rejection-before-event, same tick, either first), and the React reducer
 * state lags a render behind both. This module owns the synchronous
 * registries that resolve those races — the authoritative completions map,
 * the retry-state map, and the warning-toast claim set — so every ordering is
 * decided by plain function calls that unit tests can drive directly.
 */
export type HandoffLifecycleToast = {
	title: string;
	description?: string;
	variant?: "destructive";
	/**
	 * When set, the caller should attach a "Connect GitHub" action that opens
	 * this URL. The action itself is JSX, so the coordinator stays pure and
	 * hands the URL back through the toast effect instead.
	 */
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
	pendingPrompt?: PendingHandoffPrompt;
	/**
	 * Whether the source thread is still the active chat view. Scoped to the
	 * pane that ran the RPC, so it travels per-call instead of living in the
	 * effects; the event path never consults it (mirroring the pre-extraction
	 * behavior). Absent means "assume active".
	 */
	isThreadActive?: () => boolean;
};

export type HandoffRpcRejectedContext = {
	handoffAttemptId?: string;
	error: unknown;
	nextCommand: string;
	sourceAttachments: File[];
	/**
	 * The reducer entry for the source session IF it already shows a completed
	 * handoff, read by the caller at rejection time. The coordinator's own
	 * registry wins the same-tick race; this reducer-fed fallback covers
	 * completions that landed a render earlier.
	 */
	reducerEntryIsComplete?: {
		receipt: HandoffReceipt;
		externalPresentation: boolean;
		warningKind?: "unqueued" | "unconfirmed";
	};
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
			const acceptedAttempt = handoffAttemptId;
			const key = attemptKey(sourceSessionId, handoffAttemptId);
			const sourceThreadId = sourceThreadIds.get(key);
			if (progress.phase === "complete" && completions.has(key)) return;
			let retryDraft: string | undefined;
			let retryAttachments: File[] | undefined;
			let retryDelivered = false;
			const latestAttempt = latestAttempts.get(sourceSessionId);
			const newerRetry =
				handoffAttemptId && latestAttempt && latestAttempt !== handoffAttemptId
					? retryStates.get(attemptKey(sourceSessionId, latestAttempt))
					: undefined;
			const retainNewerRetry = Boolean(
				newerRetry?.command || newerRetry?.attachments?.length,
			);
			if (
				progress.phase === "complete" &&
				progress.sessionId?.trim() &&
				progress.dashboardUrl?.trim()
			) {
				const targetSessionId = progress.sessionId.trim();
				completions.set(key, {
					targetSessionId,
					dashboardUrl: progress.dashboardUrl,
					externalPresentation: progress.destination === "external",
					warningKind: progress.warningKind,
				});
				// Completion after an RPC rejection: restore the definitely
				// unqueued command and attachments from here because the RPC path
				// already took its failure branch. Only then may the receipt
				// replace the saved recovery state.
				const saved = retryStates.get(key);
				if (progress.warningKind === "unqueued" && saved) {
					retryDraft = progress.undeliveredCommand ?? saved.command;
					retryAttachments = saved.attachments;
				} else if (saved) {
					retryStates.delete(key);
				}
				if (retryDraft || retryAttachments?.length) {
					if (progress.destination !== "external") {
						if (!targetOpenAttempts.has(key)) {
							targetOpenAttempts.add(key);
							const opened = await Promise.resolve()
								.then(() =>
									effects.openSession(targetSessionId, {
										silent: true,
										...(retryDraft ? { initialPromptDraft: retryDraft } : {}),
										...(retryAttachments?.length
											? { initialAttachments: retryAttachments }
											: {}),
										...(sourceThreadId
											? {
													expectedActiveThreadId: sourceThreadId,
												}
											: {}),
									}),
								)
								.catch(() => false);
							if (
								acceptedAttempt &&
								acceptedAttempts.get(sourceSessionId) !== acceptedAttempt
							) {
								return;
							}
							if (opened) {
								retryStates.delete(key);
								retryDelivered = true;
							}
						}
					}
				}
				if (
					acceptedAttempt &&
					acceptedAttempts.get(sourceSessionId) !== acceptedAttempt
				) {
					return;
				}
			}
			effects.dispatch({
				type: "progress",
				sourceSessionId: progress.sourceSessionId,
				phase: progress.phase,
				message: progress.message,
				dashboardUrl: progress.dashboardUrl,
				sessionId: progress.sessionId,
				destination: progress.destination,
				warningKind: progress.warningKind,
				...(retainNewerRetry
					? { retryDraft: newerRetry?.command ?? "" }
					: retryDraft
						? { retryDraft }
						: {}),
				...(retainNewerRetry
					? { retryAttachments: newerRetry?.attachments }
					: retryAttachments?.length
						? { retryAttachments }
						: {}),
				...(retainNewerRetry ? { retainRetry: true } : {}),
			});
			if (retryDelivered && !retainNewerRetry) {
				effects.dispatch({ type: "retry_delivered", sourceSessionId });
			}
			// If the RPC dies mid-flight this event is the only carrier of a
			// follow-up queue failure; surface it exactly like the RPC path.
			if (progress.phase === "complete") {
				const warningToast = buildHandoffWarningToast(progress);
				if (warningToast && claimWarningToast(progress.sourceSessionId)) {
					effects.toast(warningToast);
				}
			}
		},

		/** The success tail of the handoff RPC. Throws when the result carries
		 * no cloud session, so the caller's catch routes into onRpcRejected. */
		async onRpcResolved(
			sourceSessionId: string,
			ctx: HandoffRpcResolvedContext,
		): Promise<void> {
			const { result, nextCommand, sourceAttachments, pendingPrompt } = ctx;
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
			const receipt = { targetSessionId, dashboardUrl };
			const destination = result.destination ?? "in_app";
			const key = attemptKey(sourceSessionId, ctx.handoffAttemptId);
			completions.set(key, {
				targetSessionId,
				dashboardUrl,
				externalPresentation: destination === "external",
				warningKind: result.warningKind,
			});
			// A warning means the follow-up command was NOT queued. Clear the
			// optimistic bubble (it would read as sent), but preserve the
			// user's command by pre-filling the target session's composer —
			// the completed source is read-only, so this is the only copy.
			const undeliveredCommand =
				result.warning && result.warningKind !== "unconfirmed"
					? nextCommand.trim() || undefined
					: undefined;
			// The images travel with the command: a definite queue failure
			// dropped them too, so restore them into the target composer.
			const undeliveredAttachments =
				result.warning &&
				result.warningKind !== "unconfirmed" &&
				sourceAttachments.length > 0
					? sourceAttachments
					: undefined;
			effects.dispatch({
				type: "complete",
				sourceSessionId,
				receipt,
				externalPresentation: destination === "external",
				pendingPrompt,
				...(result.warningKind ? { warningKind: result.warningKind } : {}),
				...(undeliveredCommand ? { retryDraft: undeliveredCommand } : {}),
				...(undeliveredAttachments
					? { retryAttachments: undeliveredAttachments }
					: {}),
			});
			if (result.warning) {
				effects.dispatch({
					type: "prompt_reconciled",
					sourceSessionId: targetSessionId,
				});
			}
			if (shouldOpenHandoffInApp(destination, ctx.isThreadActive?.() ?? true)) {
				if (!targetOpenAttempts.has(key)) {
					targetOpenAttempts.add(key);
					const opened = await Promise.resolve(
						effects.openSession(targetSessionId, {
							silent: true,
							...(undeliveredCommand
								? { initialPromptDraft: undeliveredCommand }
								: {}),
							...(undeliveredAttachments
								? { initialAttachments: undeliveredAttachments }
								: {}),
						}),
					).catch(() => false);
					if (opened && (undeliveredCommand || undeliveredAttachments)) {
						effects.dispatch({ type: "retry_delivered", sourceSessionId });
					}
					if (!opened) {
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
					}
				}
			} else if (destination === "external") {
				await effects.openExternal(dashboardUrl).catch(() =>
					effects.toast({
						title: "Cloud handoff complete",
						description: "Use the recovery link to open the cloud session.",
					}),
				);
			} else {
				effects.toast({
					title: "Cloud handoff complete",
					description: "The cloud session is ready in your session list.",
				});
			}
			if (result.warning) {
				const warningToast = buildHandoffWarningToast({
					warning: result.warning,
					warningKind: result.warningKind,
					undeliveredCommand,
				});
				// The completion event usually lands first and claims the
				// toast; only surface it here when the event path did not.
				if (warningToast && claimWarningToast(sourceSessionId)) {
					effects.toast(warningToast);
				}
			}
		},

		/** The failure tail of the handoff RPC (its catch block). */
		async onRpcRejected(
			sourceSessionId: string,
			ctx: HandoffRpcRejectedContext,
		): Promise<void> {
			const { error, nextCommand, sourceAttachments } = ctx;
			const key = attemptKey(sourceSessionId, ctx.handoffAttemptId);
			// The authoritative completion event may have landed while the
			// RPC transport failed; the handoff succeeded, so a destructive
			// "failed" toast would contradict the visible receipt.
			// The reducer-fed entry lags a render; this registry is written
			// synchronously at event arrival and wins the same-tick race.
			const syncCompletion = completions.get(key);
			const completedEntry = syncCompletion
				? {
						receipt: {
							targetSessionId: syncCompletion.targetSessionId,
							dashboardUrl: syncCompletion.dashboardUrl,
						},
						externalPresentation: syncCompletion.externalPresentation,
						warningKind: syncCompletion.warningKind,
					}
				: ctx.handoffAttemptId
					? undefined
					: ctx.reducerEntryIsComplete;
			if (completedEntry) {
				// The event told the user their command was kept; honor that
				// even though the RPC (the usual restoration driver) is gone.
				const restoreCommand =
					completedEntry.warningKind === "unqueued"
						? nextCommand.trim() || undefined
						: undefined;
				const restoreAttachments =
					completedEntry.warningKind === "unqueued" &&
					sourceAttachments.length > 0
						? sourceAttachments
						: undefined;
				effects.dispatch({
					type: "complete",
					sourceSessionId,
					receipt: completedEntry.receipt,
					externalPresentation: completedEntry.externalPresentation,
					...(completedEntry.warningKind
						? { warningKind: completedEntry.warningKind }
						: {}),
					...(restoreCommand ? { retryDraft: restoreCommand } : {}),
					...(restoreAttachments
						? { retryAttachments: restoreAttachments }
						: {}),
				});
				if (
					(restoreCommand || restoreAttachments) &&
					shouldOpenHandoffInApp(
						completedEntry.externalPresentation ? "external" : "in_app",
						ctx.isThreadActive?.() ?? true,
					) &&
					!targetOpenAttempts.has(key)
				) {
					targetOpenAttempts.add(key);
					const opened = await Promise.resolve()
						.then(() =>
							effects.openSession(completedEntry.receipt.targetSessionId, {
								silent: true,
								...(restoreCommand
									? { initialPromptDraft: restoreCommand }
									: {}),
								...(restoreAttachments
									? { initialAttachments: restoreAttachments }
									: {}),
							}),
						)
						.catch(() => false);
					if (!opened) {
						effects.dispatch({
							type: "target_open_failed",
							sourceSessionId,
							dashboardUrl: completedEntry.receipt.dashboardUrl,
							retryDraft: restoreCommand,
							retryAttachments: sourceAttachments,
						});
					} else {
						effects.dispatch({ type: "retry_delivered", sourceSessionId });
					}
				}
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
				exposeRecovery: true,
				retryDraft: nextCommand ? `/handoff ${nextCommand}` : "/handoff",
				retryAttachments: sourceAttachments,
			});
			toastFailure(error);
		},
	};
}

export type HandoffLifecycle = ReturnType<typeof createHandoffLifecycle>;
