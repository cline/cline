import {
	type AgentEvent,
	type CheckpointEntry,
	readSessionCheckpointHistory,
	SessionSource,
	type TeamEvent,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type UserInstructionConfigService,
} from "@clinebot/core";
import type { Message } from "@clinebot/shared";
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

export function createInteractiveSessionRuntime(input: {
	config: Config;
	userInstructionService?: UserInstructionConfigService;
	resumeSessionId?: string;
	chatCommandState: ChatCommandState;
	requestToolApproval: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
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

	const initialResumeSessionId = input.resumeSessionId?.trim() || undefined;

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
		return buildInteractiveSessionConfig({
			config: input.config,
			chatCommandState: input.chatCommandState,
			runtimeHooks,
			onTeamEvent: input.onTeamEvent,
			resolveMistakeLimitDecision: input.resolveMistakeLimitDecision,
		});
	};

	const startFreshSession = async (
		initial: Message[] = [],
		sessionMetadata?: Record<string, unknown>,
	): Promise<void> => {
		const manager = await ensureSessionManager();
		const started = await manager.start({
			source: SessionSource.CLI,
			config: buildSessionConfig(),
			toolPolicies: input.config.toolPolicies,
			interactive: true,
			initialMessages: initial,
			...(sessionMetadata ? { sessionMetadata } : {}),
			localRuntime: {
				userInstructionService: input.userInstructionService,
				onTeamRestored: () => {},
			},
		});
		applyStartedSession(started);
	};

	const startResumedSession = async (
		resumeId: string,
		initial: Message[] | undefined,
	): Promise<void> => {
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
				userInstructionService: input.userInstructionService,
				onTeamRestored: () => {},
			},
		});
		applyStartedSession(started);
	};

	const ensureReady = async (): Promise<void> => {
		if (startupPromise) {
			return await startupPromise;
		}
		startupPromise = (async () => {
			const manager = await ensureSessionManager();
			const initialMessages = await loadInteractiveResumeMessages(
				manager,
				input.resumeSessionId,
			);
			if (shutdownRequested) {
				return;
			}
			if (initialResumeSessionId) {
				await startResumedSession(initialResumeSessionId, initialMessages);
			} else {
				await startFreshSession(initialMessages);
			}
		})().catch((error) => {
			startupError = error;
			throw error;
		});
		return await startupPromise;
	};

	const readCurrentMessages = async (): Promise<Message[]> => {
		if (!sessionManager || !activeSessionId) {
			return [];
		}
		return (await sessionManager.readMessages(activeSessionId)) ?? [];
	};

	const stopCurrentSession = async (): Promise<void> => {
		if (sessionManager && activeSessionId) {
			await sessionManager.stop(activeSessionId);
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
		const [row, messages, usage] = await Promise.all([
			manager.get(sessionId).catch(() => undefined),
			manager.readMessages(sessionId).catch(() => []),
			manager.getAccumulatedUsage(sessionId).catch(() => undefined),
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
	): Promise<void> => {
		await stopCurrentSession();
		await startFreshSession(messages, sessionMetadata);
	};

	const restartWithCurrentMessages = async (): Promise<void> => {
		const messages = await readCurrentMessages();
		await restartWithMessages(messages);
	};

	const restartEmpty = async (): Promise<void> => {
		await restartWithMessages([]);
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
		return await sessionManager.send({
			sessionId: activeSessionId,
			...turnInput,
		});
	};

	const getAccumulatedUsage = async (
		fallback: NonNullable<CurrentTurnResult>["usage"],
	) => {
		if (!sessionManager) {
			return fallback;
		}
		return (
			(await sessionManager.getAccumulatedUsage(activeSessionId)) ?? fallback
		);
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
		await manager.stop(forkedFromSessionId);
		const forkMetadata = buildForkSessionMetadata({
			forkedFromSessionId,
			forkedAt: new Date().toISOString(),
			sourceSession: sessionRecord,
			messages,
		});
		await startFreshSession(messages, forkMetadata);
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
		compacted: boolean;
	}> => {
		if (!sessionManager) {
			return { messagesBefore: 0, messagesAfter: 0, compacted: false };
		}
		const messages = await readCurrentMessages();
		const messagesBefore = messages.length;
		if (messagesBefore === 0) {
			return { messagesBefore: 0, messagesAfter: 0, compacted: false };
		}
		const result = await compactInteractiveMessages({
			config: input.config,
			sessionId: activeSessionId,
			messages,
		});
		if (!result.compacted) {
			return {
				messagesBefore,
				messagesAfter: messagesBefore,
				compacted: false,
			};
		}
		await restartWithMessages(result.messages);
		return {
			messagesBefore,
			messagesAfter: result.messages.length,
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
		const messages = await readCurrentMessages();
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
					userInstructionService: input.userInstructionService,
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
			} finally {
				unsubscribeAgent();
				unsubscribePendingPrompts();
			}
			try {
				exitSummary = await getExitSummary();
				await stopCurrentSession();
			} finally {
				try {
					if (sessionManager) {
						await sessionManager.dispose("cli_interactive_shutdown");
					}
				} finally {
					await runtimeHooks?.shutdown();
				}
			}
			return exitSummary;
		})();
		return await cleanupPromise;
	};

	return {
		ensureReady,
		sendCurrentTurn,
		getAccumulatedUsage,
		readCurrentMessages,
		restartEmpty,
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
