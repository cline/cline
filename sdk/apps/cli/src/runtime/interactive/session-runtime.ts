import {
	type AgentEvent,
	type Llms,
	SessionSource,
	type TeamEvent,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";
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
import type {
	PendingPromptSnapshot,
	PendingPromptSubmittedEvent,
} from "../session-events";
import {
	subscribeToAgentEvents,
	subscribeToPendingPromptEvents,
} from "../session-events";
import { compactInteractiveMessages } from "./compaction";
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
	userInstructionWatcher?: UserInstructionConfigWatcher;
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
			manifestPath: started.manifestPath,
			messagesPath: started.messagesPath,
			manifest: started.manifest,
		});
		activeSessionId = started.sessionId;
	};

	const ensureSessionManager = async (): Promise<CliCore> => {
		if (sessionManager) {
			return sessionManager;
		}
		const manager = await createCliCore({
			backendMode: "hub",
			defaultToolExecutors: {
				askQuestion: (question, options) => {
					if (input.askQuestionRef.current) {
						return input.askQuestionRef.current(question, options);
					}
					return Promise.resolve(options[0] ?? "");
				},
				submit: submitAndExitInTerminal,
			},
			logger: input.config.logger,
			cwd: input.config.cwd,
			workspaceRoot: input.config.workspaceRoot,
			toolPolicies: input.config.toolPolicies,
			requestToolApproval: input.requestToolApproval,
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
				await manager.handleHookEvent(payload);
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
		initial: Llms.Message[] = [],
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
				userInstructionWatcher: input.userInstructionWatcher,
				onTeamRestored: () => {},
			},
		});
		applyStartedSession(started);
	};

	const startResumedSession = async (
		resumeId: string,
		initial: Llms.Message[] | undefined,
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
				userInstructionWatcher: input.userInstructionWatcher,
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

	const readCurrentMessages = async (): Promise<Llms.Message[]> => {
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

	const restartWithMessages = async (
		messages: Llms.Message[],
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
			userInstructionWatcher: input.userInstructionWatcher,
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
		const checkpointMetadata = sessionRecord?.metadata?.checkpoint ?? undefined;
		const forkMetadata: Record<string, unknown> = {
			fork: {
				forkedFromSessionId,
				forkedAt: new Date().toISOString(),
				source: sessionRecord?.source ?? SessionSource.CLI,
				...(checkpointMetadata !== undefined
					? { checkpoints: checkpointMetadata }
					: {}),
			},
		};
		if (sessionRecord?.metadata) {
			for (const [key, value] of Object.entries(sessionRecord.metadata)) {
				if (key !== "fork") {
					forkMetadata[key] = value;
				}
			}
		}
		await startFreshSession(messages, forkMetadata);
		return { forkedFromSessionId, newSessionId: activeSessionId };
	};

	const resumeSession = async (sessionId: string): Promise<Llms.Message[]> => {
		await stopCurrentSession();
		const manager = await ensureSessionManager();
		const messages = await loadInteractiveResumeMessages(manager, sessionId);
		await startResumedSession(sessionId, messages);
		return messages ?? [];
	};

	const compactCurrentSession = async (): Promise<{
		messagesBefore: number;
		messagesAfter: number;
	}> => {
		if (!sessionManager) {
			return { messagesBefore: 0, messagesAfter: 0 };
		}
		const messages = await readCurrentMessages();
		const messagesBefore = messages.length;
		if (messagesBefore === 0) {
			return { messagesBefore: 0, messagesAfter: 0 };
		}
		const compactedMessages = await compactInteractiveMessages({
			config: input.config,
			sessionId: activeSessionId,
			messages,
		});
		await restartWithMessages(compactedMessages);
		return {
			messagesBefore,
			messagesAfter: compactedMessages.length,
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
		sessionManager
			.abort(activeSessionId, new Error("Interactive runtime abort requested"))
			.catch(() => {});
		return true;
	};

	let cleanupPromise: Promise<void> | undefined;
	const cleanup = async (): Promise<void> => {
		if (cleanupPromise) {
			return await cleanupPromise;
		}
		cleanupPromise = (async () => {
			shutdownRequested = true;
			try {
				await startupPromise?.catch(() => {});
			} finally {
				unsubscribeAgent();
				unsubscribePendingPrompts();
			}
			try {
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
		applyMode,
		resetAbortRequest,
		abortAll,
		cleanup,
		getActiveSessionId: () => activeSessionId,
		isShutdownRequested: () => shutdownRequested,
	};
}
