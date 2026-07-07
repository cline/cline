import {
	type AgentEvent,
	type AgentHooks,
	type CheckpointEntry,
	createSessionCompactionState,
	isSessionNotFoundError,
	type PendingPromptMutationResult,
	type ProviderSettingsManager,
	projectSessionCompactionState,
	readSessionCheckpointHistory,
	type SessionCompactionState,
	SessionSource,
	type TeamEvent,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type UserInstructionConfigService,
} from "@cline/core";
import type { Message } from "@cline/shared";
import { createCliCore } from "../../session/session";
import { submitAndExitInTerminal } from "../../utils/approval";
import type {
	ChatCommandState,
	ForkSessionResult,
} from "../../utils/chat-commands";
import { createRuntimeHooks } from "../../utils/hooks";
import { setActiveCliSession } from "../../utils/output";
import { loadInteractiveResumeMessages } from "../../utils/resume";
import type { Config } from "../../utils/types";
import { markAbortInProgress } from "../active-runtime";
import type {
	PendingPromptSnapshot,
	PendingPromptSubmittedEvent,
} from "../session-events";
import {
	subscribeToAgentEvents,
	subscribeToPendingPromptEvents,
} from "../session-events";
import { compactInteractiveMessages } from "./compaction";
import {
	createInteractiveExitSummary,
	type InteractiveExitSummary,
} from "./exit-summary";
import { buildForkSessionMetadata } from "./fork/metadata";
import { applyInteractiveModeConfig } from "./mode";
import { buildInteractiveSessionConfig } from "./session-config";

type CliCore = Awaited<ReturnType<typeof createCliCore>>;
type RuntimeHooks = ReturnType<typeof createRuntimeHooks>;
type StartedSession = Awaited<ReturnType<CliCore["start"]>>;
type CurrentTurnInput = Omit<Parameters<CliCore["send"]>[0], "sessionId">;
type CurrentTurnResult = Awaited<ReturnType<CliCore["send"]>>;
type AskQuestionRef = {
	current: ((question: string, options: string[]) => Promise<string>) | null;
};
type CurrentMessagesRead =
	| { messages: Message[]; status: "read" }
	| { messages: Message[]; status: "recovered" }
	| { messages: Message[]; status: "stale" };
type MissingSessionRecovery = {
	messages: Message[];
};
type ToolPolicyResolver = (
	toolName: string,
) => NonNullable<Config["toolPolicies"]>[string];

function withInteractiveApprovalPolicyHook(
	hooks: AgentHooks | undefined,
	resolveToolPolicy: ToolPolicyResolver,
): AgentHooks {
	return {
		...hooks,
		beforeTool: async (ctx) => {
			const result = await hooks?.beforeTool?.(ctx);
			if (result?.stop || result?.skip) {
				return result;
			}
			const policy = resolveToolPolicy(ctx.toolCall.toolName);
			return {
				...result,
				policy: {
					...result?.policy,
					autoApprove: policy.autoApprove,
				},
			};
		},
	};
}

export function createInteractiveSessionRuntime(input: {
	config: Config;
	providerSettingsManager: ProviderSettingsManager;
	userInstructionService?: UserInstructionConfigService;
	resumeSessionId?: string;
	chatCommandState: ChatCommandState;
	requestToolApproval: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	resolveToolPolicy: ToolPolicyResolver;
	askQuestionRef: AskQuestionRef;
	resolveMistakeLimitDecision: Config["onConsecutiveMistakeLimitReached"];
	switchToActModeTool: NonNullable<Config["extraTools"]>[number];
	onAgentEvent: (event: AgentEvent) => void;
	onTeamEvent: (event: TeamEvent) => void;
	onPendingPrompts: (event: PendingPromptSnapshot) => void;
	onPendingPromptSubmitted: (event: PendingPromptSubmittedEvent) => void;
}) {
	let sessionManager: CliCore | undefined;
	let runtimeHooks: RuntimeHooks | undefined;
	let unsubscribeAgent = () => {};
	let unsubscribePendingPrompts = () => {};
	let startupPromise: Promise<void> | undefined;
	let startupError: unknown;
	let shutdownRequested = false;
	let activeSessionId = "";
	let abortRequested = false;
	let missingSessionRecoveryPromise:
		| Promise<MissingSessionRecovery>
		| undefined;
	// A reset can happen while an earlier manager.start() is still in flight.
	// Bump this before resets and restarts so stale starts cannot become active.
	let sessionStartGeneration = 0;
	let manualCompactionAbortController: AbortController | undefined;

	let pendingResumeSessionId = input.resumeSessionId?.trim() || undefined;

	const clearActiveSession = (): void => {
		activeSessionId = "";
		setActiveCliSession(undefined);
	};

	const applyStartedSession = (started: StartedSession): void => {
		setActiveCliSession({
			manifest: started.manifest,
		});
		activeSessionId = started.sessionId;
	};

	const ensureSessionManager = async (): Promise<CliCore> => {
		if (sessionManager) {
			return sessionManager;
		}
		const manager = await createCliCore({
			// Interactive startup must never wait for a detached hub daemon to boot.
			// `auto` uses an already-compatible hub when one is immediately available,
			// but falls back to the local runtime while the hub is prewarmed in the
			// background. Forcing `hub` here routes through `ensureCompatibleLocalHubUrl`,
			// which can poll for up to the hub startup timeout before the TUI is usable.
			// Yolo and sandbox modes must stay fully local and must not prewarm or reuse
			// the shared daemon hub.
			backendMode: "auto",
			forceLocalBackend:
				input.config.mode === "yolo" || input.config.sandbox === true,
			capabilities: {
				toolExecutors: {
					askQuestion: (question, options) => {
						if (input.askQuestionRef.current) {
							return input.askQuestionRef.current(question, options);
						}
						return Promise.resolve(options[0] ?? "");
					},
					submit: submitAndExitInTerminal,
				},
				requestToolApproval: input.requestToolApproval,
			},
			logger: input.config.logger,
			cwd: input.config.cwd,
			workspaceRoot: input.config.workspaceRoot,
			toolPolicies: input.config.toolPolicies,
		});
		if (shutdownRequested) {
			await manager.dispose("cli_interactive_startup_cancelled");
			throw new Error("interactive runtime shutdown requested");
		}
		sessionManager = manager;
		runtimeHooks = createRuntimeHooks({
			verbose: input.config.verbose,
			yolo: input.config.mode === "yolo",
			cwd: input.config.cwd,
			workspaceRoot: input.config.workspaceRoot,
			dispatchHookEvent: async (payload) => {
				await manager.ingestHookEvent(payload);
			},
		});
		unsubscribeAgent = subscribeToAgentEvents(manager, input.onAgentEvent);
		unsubscribePendingPrompts = subscribeToPendingPromptEvents(manager, {
			onPendingPrompts: input.onPendingPrompts,
			onPendingPromptSubmitted: input.onPendingPromptSubmitted,
		});
		return manager;
	};

	const buildSessionConfig = (): Config => {
		if (!runtimeHooks) {
			throw new Error("interactive runtime hooks are unavailable");
		}
		const hooks = withInteractiveApprovalPolicyHook(
			runtimeHooks.hooks,
			input.resolveToolPolicy,
		);
		return buildInteractiveSessionConfig({
			config: input.config,
			chatCommandState: input.chatCommandState,
			runtimeHooks: { hooks },
			onTeamEvent: input.onTeamEvent,
			resolveMistakeLimitDecision: input.resolveMistakeLimitDecision,
		});
	};

	const startFreshSession = async (
		initial: Message[] = [],
		sessionMetadata?: Record<string, unknown>,
		initialCompactionState?: SessionCompactionState,
	): Promise<void> => {
		const generation = sessionStartGeneration;
		const manager = await ensureSessionManager();
		const started = await manager.start({
			source: SessionSource.CLI,
			config: buildSessionConfig(),
			toolPolicies: input.config.toolPolicies,
			interactive: true,
			initialMessages: initial,
			...(initialCompactionState ? { initialCompactionState } : {}),
			...(sessionMetadata ? { sessionMetadata } : {}),
			localRuntime: {
				onTeamRestored: () => {},
			},
		});
		if (generation !== sessionStartGeneration) {
			await manager.stop(started.sessionId).catch(() => {});
			return;
		}
		applyStartedSession(started);
	};

	const startResumedSession = async (
		resumeId: string,
		initial: Message[] | undefined,
	): Promise<void> => {
		const generation = sessionStartGeneration;
		const manager = await ensureSessionManager();
		const started = await manager.start({
			source: SessionSource.CLI,
			config: {
				...buildSessionConfig(),
				sessionId: resumeId,
			},
			toolPolicies: input.config.toolPolicies,
			interactive: true,
			initialMessages: initial,
			localRuntime: {
				onTeamRestored: () => {},
			},
		});
		if (generation !== sessionStartGeneration) {
			await manager.stop(started.sessionId).catch(() => {});
			return;
		}
		applyStartedSession(started);
	};

	const ensureReady = async (): Promise<void> => {
		if (activeSessionId) {
			return;
		}
		if (startupPromise) {
			return await startupPromise;
		}
		startupPromise = (async () => {
			const manager = await ensureSessionManager();
			const resumeSessionId = pendingResumeSessionId;
			const initialMessages = await loadInteractiveResumeMessages(
				manager,
				resumeSessionId,
			);
			if (shutdownRequested) {
				return;
			}
			if (resumeSessionId) {
				await startResumedSession(resumeSessionId, initialMessages);
				if (pendingResumeSessionId === resumeSessionId) {
					pendingResumeSessionId = undefined;
				}
			} else {
				await startFreshSession(initialMessages);
			}
		})().catch((error) => {
			startupError = error;
			throw error;
		});
		return await startupPromise;
	};

	const readCurrentMessages = async (): Promise<CurrentMessagesRead> => {
		const manager = sessionManager;
		const sessionId = activeSessionId;
		if (!manager || !sessionId) {
			return { messages: [], status: "read" };
		}
		try {
			const messages = (await manager.readMessages(sessionId)) ?? [];
			return {
				messages,
				status: activeSessionId === sessionId ? "read" : "stale",
			};
		} catch (error) {
			if (
				abortRequested ||
				shutdownRequested ||
				!isSessionNotFoundError(error)
			) {
				throw error;
			}
			const recovery = await recoverMissingActiveSession(error);
			return { messages: recovery.messages, status: "recovered" };
		}
	};

	const readCompactionState = async (
		sessionId: string,
	): Promise<SessionCompactionState | undefined> => {
		const manager = sessionManager;
		if (!manager) {
			return undefined;
		}
		try {
			return await manager.readSessionCompactionState(sessionId);
		} catch (error) {
			input.config.logger?.log?.("Failed to read session compaction state", {
				sessionId,
				error,
				severity: "warn",
			});
			return undefined;
		}
	};

	const recoverMissingActiveSession = async (
		error: unknown,
	): Promise<MissingSessionRecovery> => {
		if (missingSessionRecoveryPromise) {
			return await missingSessionRecoveryPromise;
		}
		missingSessionRecoveryPromise = (async () => {
			const manager = sessionManager;
			const missingSessionId = activeSessionId;
			if (!manager || !missingSessionId || shutdownRequested) {
				return { messages: [] };
			}
			const messages = await manager
				.readMessages(missingSessionId)
				.catch(() => []);
			input.config.logger?.log("Recovering missing interactive session", {
				sessionId: missingSessionId,
				messageCount: messages.length,
				error,
				severity: "warn",
			});
			sessionStartGeneration += 1;
			pendingResumeSessionId = undefined;
			startupPromise = undefined;
			startupError = undefined;
			clearActiveSession();
			await startFreshSession(messages);
			return { messages };
		})().finally(() => {
			missingSessionRecoveryPromise = undefined;
		});
		return await missingSessionRecoveryPromise;
	};

	const readCurrentCompactionState = async (): Promise<
		SessionCompactionState | undefined
	> => {
		if (!activeSessionId) {
			return undefined;
		}
		return await readCompactionState(activeSessionId);
	};

	const stopCurrentSession = async (): Promise<void> => {
		const sessionId = activeSessionId;
		if (sessionManager && sessionId) {
			await sessionManager.stop(sessionId);
		}
	};

	const getExitSummary = async (): Promise<
		InteractiveExitSummary | undefined
	> => {
		const manager = sessionManager;
		const sessionId = activeSessionId.trim();
		if (!manager || !sessionId) {
			return undefined;
		}
		const readUsage = async () => {
			const usageSummary = await manager
				.getAccumulatedUsage(sessionId)
				.catch(() => undefined);
			return usageSummary?.aggregateUsage ?? usageSummary?.usage;
		};
		const [row, messages, usage] = await Promise.all([
			manager.get(sessionId).catch(() => undefined),
			manager.readMessages(sessionId).catch(() => []),
			readUsage(),
		]);
		return createInteractiveExitSummary({
			sessionId,
			row,
			messages,
			usage,
		});
	};

		const restartWithMessages = async (
			messages: Message[],
			sessionMetadata?: Record<string, unknown>,
			initialCompactionState?: SessionCompactionState,
		): Promise<void> => {
			sessionStartGeneration += 1;
			pendingResumeSessionId = undefined;
			startupError = undefined;
			// Publish the restart as the in-flight startup. Teardown leaves a window
			// with no active session, and without this barrier a concurrent
			// ensureReady() (e.g. a message submitted right after a plan/act toggle)
			// reads that window as "no session" and boots an empty session that then
			// races the restarted one for the active slot.
			const restart = (async () => {
				await stopCurrentSession();
				clearActiveSession();
				await startFreshSession(
					messages,
					sessionMetadata,
					initialCompactionState,
				);
			})().catch((error) => {
				startupError = error;
				throw error;
			});
			startupPromise = restart;
			try {
				await restart;
			} finally {
				// Restore the pre-restart steady state (startupPromise unset) so a
				// failed restart stays retryable by the next ensureReady(). A newer
				// startup that already replaced the barrier is left alone.
				if (startupPromise === restart) {
					startupPromise = undefined;
				}
			}
		};

	const restartWithCurrentMessages = async (): Promise<void> => {
		const [{ messages, status }, compactionState] = await Promise.all([
			readCurrentMessages(),
			readCurrentCompactionState(),
		]);
		if (status !== "read") {
			// If reading recovered a missing hub session, the current messages are
			// already in the replacement session. If the read is stale, another async
			// operation changed the active session while this read was in flight.
			return;
		}
		const projectedMessages = compactionState
			? projectSessionCompactionState(compactionState, messages)
			: undefined;
		await restartWithMessages(
			messages,
			undefined,
			projectedMessages
				? createSessionCompactionState({
						sourceMessages: messages,
						compactedMessages: projectedMessages,
						systemPrompt: compactionState?.system_prompt,
					})
				: undefined,
		);
	};

	const restartEmpty = async (): Promise<void> => {
		await restartWithMessages([]);
	};

	const resetForNewSession = async (): Promise<void> => {
		sessionStartGeneration += 1;
		pendingResumeSessionId = undefined;
		startupPromise = undefined;
		startupError = undefined;
		const manager = sessionManager;
		const sessionId = activeSessionId;
		clearActiveSession();
		if (manager && sessionId) {
			await manager.stop(sessionId);
		}
	};

	const applyMode = async (mode: "plan" | "act"): Promise<void> => {
		await applyInteractiveModeConfig({
			config: input.config,
			mode,
			switchToActModeTool: input.switchToActModeTool,
		});
		await restartWithCurrentMessages();
	};

	const sendCurrentTurn = async (
		turnInput: CurrentTurnInput,
	): Promise<CurrentTurnResult> => {
		if (!sessionManager) {
			throw startupError instanceof Error
				? startupError
				: new Error("interactive session manager is unavailable");
		}
		const manager = sessionManager;
		try {
			return await manager.send({
				sessionId: activeSessionId,
				...turnInput,
			});
		} catch (error) {
			if (
				abortRequested ||
				shutdownRequested ||
				!isSessionNotFoundError(error)
			) {
				throw error;
			}
			await recoverMissingActiveSession(error);
			if (!activeSessionId || abortRequested || shutdownRequested) {
				throw error;
			}
			return await manager.send({
				sessionId: activeSessionId,
				...turnInput,
			});
		}
	};

	const updatePendingPrompt = async (input: {
		promptId: string;
		prompt?: string;
		delivery?: "queue" | "steer";
	}): Promise<PendingPromptMutationResult> => {
		if (!sessionManager) {
			throw startupError instanceof Error
				? startupError
				: new Error("interactive session manager is unavailable");
		}
		const result = await sessionManager.pendingPrompts.update({
			sessionId: activeSessionId,
			...input,
		});
		return {
			sessionId: result.sessionId,
			prompts: result.prompts,
			prompt: result.prompt,
			updated: result.updated,
			removed: result.removed,
		};
	};

	const getAccumulatedUsage = async (
		fallback: NonNullable<CurrentTurnResult>["usage"],
	) => {
		if (!sessionManager) {
			return fallback;
		}
		const usageSummary =
			await sessionManager.getAccumulatedUsage(activeSessionId);
		return usageSummary?.aggregateUsage ?? usageSummary?.usage ?? fallback;
	};

	const forkCurrentSession = async (): Promise<
		ForkSessionResult | undefined
	> => {
		const manager = sessionManager;
		if (!manager || !activeSessionId) {
			return undefined;
		}
		const forkedFromSessionId = activeSessionId;
		const sessionRecord = await manager.get(forkedFromSessionId);
		const messages = await manager
			.readMessages(forkedFromSessionId)
			.catch(() => undefined);
		if (!messages) {
			return undefined;
		}
		if (messages.length === 0) {
			throw new Error("Cannot fork an empty session.");
		}
		const compactionState = await readCompactionState(forkedFromSessionId);
		const projectedMessages = compactionState
			? projectSessionCompactionState(compactionState, messages)
			: undefined;
		await manager.stop(forkedFromSessionId);
		const forkMetadata = buildForkSessionMetadata({
			forkedFromSessionId,
			forkedAt: new Date().toISOString(),
			sourceSession: sessionRecord,
			messages,
		});
		await startFreshSession(
			messages,
			forkMetadata,
			projectedMessages
				? createSessionCompactionState({
						sourceMessages: messages,
						compactedMessages: projectedMessages,
						systemPrompt: compactionState?.system_prompt,
					})
				: undefined,
		);
		return { forkedFromSessionId, newSessionId: activeSessionId };
	};

	const resumeSession = async (sessionId: string): Promise<Message[]> => {
		const manager = await ensureSessionManager();
		const sessionRecord = await manager.get(sessionId);
		if (!sessionRecord) {
			throw new Error(`Session ${sessionId} was not found.`);
		}
		const messages = await loadInteractiveResumeMessages(manager, sessionId);
		if (!messages || messages.length === 0) {
			throw new Error(`Session ${sessionId} has no messages to resume.`);
		}
		await stopCurrentSession();
		await startResumedSession(sessionId, messages);
		return messages;
	};

	const compactCurrentSession = async (): Promise<{
		messagesBefore: number;
		messagesAfter: number;
		workingContextMessagesAfter?: number;
		compacted: boolean;
	}> => {
		if (input.config.compaction?.enabled === false) {
			throw new Error(
				"Cannot compact because compaction is off for this session.",
			);
		}
		const manager = sessionManager;
		const sourceSessionId = activeSessionId;
		if (!manager || !sourceSessionId) {
			return { messagesBefore: 0, messagesAfter: 0, compacted: false };
		}
		const { messages, status } = await readCurrentMessages();
		if (status === "stale" || (status === "recovered" && !activeSessionId)) {
			return { messagesBefore: 0, messagesAfter: 0, compacted: false };
		}
		// If reading messages recovered the session, `messages` are the same messages
		// used to seed the replacement session, so it is safe to compact the current
		// active session with them.
		const messagesBefore = messages.length;
		if (messagesBefore === 0) {
			return { messagesBefore: 0, messagesAfter: 0, compacted: false };
		}
		const sessionRecord = await manager.get(sourceSessionId);
		if (sessionRecord?.status === "running") {
			throw new Error(
				"Cannot compact while the current turn is running. Wait for it to finish or abort it first.",
			);
		}
		let result: Awaited<ReturnType<typeof compactInteractiveMessages>>;
		const abortController = new AbortController();
		manualCompactionAbortController = abortController;
		try {
			result = await compactInteractiveMessages({
				config: input.config,
				providerSettingsManager: input.providerSettingsManager,
				sessionId: sourceSessionId,
				messages,
				abortSignal: abortController.signal,
			});
		} finally {
			if (manualCompactionAbortController === abortController) {
				manualCompactionAbortController = undefined;
			}
		}
		if (!result.compacted) {
			return {
				messagesBefore,
				messagesAfter: messagesBefore,
				compacted: false,
			};
		}
		if (!result.compactionState) {
			return {
				messagesBefore,
				messagesAfter: messagesBefore,
				compacted: false,
			};
		}
		const updated = await manager.updateSessionCompactionState(
			sourceSessionId,
			result.compactionState,
		);
		if (!updated.updated) {
			throw new Error("Compaction could not be saved. Try again.");
		}
		return {
			messagesBefore,
			messagesAfter: result.canonicalMessages.length,
			workingContextMessagesAfter: result.compactionState?.messages.length,
			compacted: true,
		};
	};

	const getCheckpointData = async (): Promise<
		| {
				messages: Message[];
				checkpointHistory: CheckpointEntry[];
		  }
		| undefined
	> => {
		if (!sessionManager || !activeSessionId) {
			return undefined;
		}
		const sessionRecord = await sessionManager.get(activeSessionId);
		if (!sessionRecord) {
			return undefined;
		}
		const checkpointHistory = readSessionCheckpointHistory(sessionRecord);
		const { messages, status } = await readCurrentMessages();
		if (status !== "read") {
			return undefined;
		}
		return { messages, checkpointHistory };
	};

	const restoreCheckpoint = async (
		runCount: number,
		restoreWorkspace: boolean,
	): Promise<{ newSessionId: string; messages: Message[] } | undefined> => {
		const manager = sessionManager;
		if (!manager || !activeSessionId) {
			return undefined;
		}
		const sourceSessionId = activeSessionId;
		const restored = await manager.restore({
			sessionId: sourceSessionId,
			checkpointRunCount: runCount,
			cwd: input.config.cwd,
			restore: {
				messages: true,
				workspace: restoreWorkspace,
				omitCheckpointMessageFromSession: true,
			},
			start: {
				source: SessionSource.CLI,
				config: buildSessionConfig(),
				toolPolicies: input.config.toolPolicies,
				interactive: true,
				localRuntime: {
					onTeamRestored: () => {},
				},
			},
		});
		if (!restored.startResult || !restored.sessionId) {
			throw new Error("Checkpoint restore did not return a new session");
		}
		applyStartedSession(restored.startResult);
		if (restored.sessionId !== sourceSessionId) {
			try {
				await manager.stop(sourceSessionId);
			} catch (error) {
				input.config.logger?.log(
					"Failed to stop source session after restore",
					{
						sessionId: sourceSessionId,
						error,
						severity: "warn",
					},
				);
			}
		}
		const restoredMessages = restored.messages ?? [];
		return {
			newSessionId: restored.sessionId,
			messages: restoredMessages,
		};
	};

	const resetAbortRequest = (): void => {
		abortRequested = false;
	};

	const abortAll = (): boolean => {
		if (abortRequested || !sessionManager || !activeSessionId) {
			return false;
		}
		abortRequested = true;
		markAbortInProgress();
		manualCompactionAbortController?.abort(
			new Error("Interactive runtime abort requested"),
		);
		sessionManager
			.abort(activeSessionId, new Error("Interactive runtime abort requested"))
			.catch(() => {});
		return true;
	};

	let cleanupPromise: Promise<InteractiveExitSummary | undefined> | undefined;
	const cleanup = async (): Promise<InteractiveExitSummary | undefined> => {
		if (cleanupPromise) {
			return await cleanupPromise;
		}
		cleanupPromise = (async () => {
			shutdownRequested = true;
			let exitSummary: InteractiveExitSummary | undefined;
			try {
				await startupPromise?.catch(() => {});
				await missingSessionRecoveryPromise?.catch(() => {});
			} finally {
				unsubscribeAgent();
				unsubscribePendingPrompts();
			}
			try {
				exitSummary = await getExitSummary();
				// Mark hooks shut down before session disposal so late abort/stop
				// emissions cannot dispatch over a closing hub transport.
				await runtimeHooks?.shutdown();
				await stopCurrentSession();
			} finally {
				if (sessionManager) {
					await sessionManager.dispose("cli_interactive_shutdown");
				}
			}
			return exitSummary;
		})();
		return await cleanupPromise;
	};

	return {
		ensureReady,
		sendCurrentTurn,
		updatePendingPrompt,
		getAccumulatedUsage,
		readCurrentMessages,
		restartEmpty,
		resetForNewSession,
		restartWithMessages,
		restartWithCurrentMessages,
		resumeSession,
		forkCurrentSession,
		compactCurrentSession,
		getCheckpointData,
		restoreCheckpoint,
		applyMode,
		resetAbortRequest,
		abortAll,
		cleanup,
		getActiveSessionId: () => activeSessionId,
		isShutdownRequested: () => shutdownRequested,
	};
}
