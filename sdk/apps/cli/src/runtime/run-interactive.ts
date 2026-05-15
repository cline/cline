import {
	getCurrentContextSize,
	type ProviderSettings,
	ProviderSettingsManager,
	type UserInstructionConfigService,
} from "@cline/core";
import type { CliMigrationNotice } from "../kanban-migration/notice";
import { logCliError } from "../logging/errors";
import {
	loadClineAccountSnapshot,
	switchClineAccount,
} from "../tui/cline-account";
import type { InteractiveConfigItem } from "../tui/interactive-config";
import {
	type InteractiveSlashCommand,
	listInteractiveSlashCommands,
	resolveClineWelcomeLine,
} from "../tui/interactive-welcome";
import { disableOpenTuiGraphicsProbe } from "../tui/opentui-env";
import type { QueuedPromptItem } from "../tui/types";
import { type ChatCommandState, chatCommandHost } from "../utils/chat-commands";
import { applyCliCompactionMode } from "../utils/compaction-mode";
import {
	prepareTerminalForPostTuiOutput,
	writeErr,
	writeln,
} from "../utils/output";
import { createWorkspaceChatCommandHost } from "../utils/plugin-chat-commands";
import { readRepoStatus } from "../utils/repo-status";
import type { Config } from "../utils/types";
import {
	clearAbortInProgress,
	isAbortInProgress,
	setActiveRuntimeAbort,
	setActiveRuntimeCleanup,
} from "./active-runtime";
import { createInteractiveApprovalController } from "./interactive/approvals";
import { runInteractiveChatCommand } from "./interactive/chat-command-runner";
import { createInteractiveConfigDataLoader } from "./interactive/config-data";
import {
	formatInteractiveExitSummary,
	type InteractiveExitSummary,
} from "./interactive/exit-summary";
import { createMistakeLimitDecisionResolver } from "./interactive/mistakes";
import { createInteractiveModeSwitchTool } from "./interactive/mode";
import { assertInteractivePreflight } from "./interactive/preflight";
import { createInteractiveSessionRuntime } from "./interactive/session-runtime";
import { buildUserInputMessage } from "./prompt";
import { getUIEventEmitter } from "./session-events";

export async function runInteractive(
	config: Config,
	userInstructionService?: UserInstructionConfigService,
	resumeSessionId?: string,
	options?: {
		clineApiBaseUrl?: string;
		clineProviderSettings?: ProviderSettings;
		initialView?: "chat" | "config";
		initialPrompt?: string;
		initialNotice?: CliMigrationNotice;
		onInitialNoticeShown?: (notice: CliMigrationNotice) => void | Promise<void>;
	},
): Promise<void> {
	assertInteractivePreflight(config);

	const initialRepoStatus = await readRepoStatus(config.cwd);
	const workflowSlashCommands = listInteractiveSlashCommands(
		userInstructionService,
	);
	let interactiveChatCommandHost = chatCommandHost;
	const configDataLoader = createInteractiveConfigDataLoader({
		config,
		userInstructionService,
	});
	const loadAdditionalSlashCommands = async (): Promise<
		InteractiveSlashCommand[]
	> => {
		const { host, pluginSlashCommands } = await createWorkspaceChatCommandHost({
			cwd: config.cwd,
			workspaceRoot: config.workspaceRoot,
			logger: config.logger,
		});
		interactiveChatCommandHost = host;
		return pluginSlashCommands.map((cmd) => ({
			name: cmd.name,
			instructions: "",
			description: cmd.description ?? "Plugin command",
		}));
	};

	const enableChatCommands = true;
	const {
		autoApproveAllRef,
		setInteractiveAutoApprove,
		requestToolApproval,
		tuiToolApprover,
		tuiAskQuestion,
	} = createInteractiveApprovalController(config);

	const pendingModeChange: { current: "plan" | "act" | null } = {
		current: null,
	};
	const tuiModeChanged: {
		current: ((mode: "plan" | "act") => void) | null;
	} = { current: null };

	const switchToActModeTool = createInteractiveModeSwitchTool({
		config,
		pendingModeChange,
		tuiModeChanged,
	});

	config.extraTools = config.mode === "plan" ? [switchToActModeTool] : [];

	const uiEvents = getUIEventEmitter();
	const chatCommandState: ChatCommandState = {
		enableTools: config.enableTools,
		autoApproveTools: autoApproveAllRef.current,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot?.trim() || config.cwd,
	};
	const resolveMistakeLimitDecision = createMistakeLimitDecisionResolver({
		autoApproveAllRef,
		askQuestionRef: tuiAskQuestion,
	});
	const providerSettingsManager = new ProviderSettingsManager();

	const sessionRuntime = createInteractiveSessionRuntime({
		config,
		providerSettingsManager,
		userInstructionService,
		resumeSessionId,
		chatCommandState,
		requestToolApproval,
		askQuestionRef: tuiAskQuestion,
		resolveMistakeLimitDecision,
		switchToActModeTool,
		onAgentEvent: (event) => {
			uiEvents.emit("agent", event);
		},
		onTeamEvent: (event) => {
			uiEvents.emit("team", event);
		},
		onPendingPrompts: (event) => {
			uiEvents.emit("pending-prompts", event);
		},
		onPendingPromptSubmitted: (event) => {
			uiEvents.emit("pending-prompt-submitted", event);
		},
	});
	let modeChangePromise: Promise<void> | undefined;
	let modeChangeTarget: "plan" | "act" | undefined;

	const isInteractiveMode = (mode: unknown): mode is "plan" | "act" =>
		mode === "plan" || mode === "act";

	const applyModeChange = (mode: "plan" | "act"): Promise<void> => {
		if (modeChangePromise && modeChangeTarget === mode) {
			return modeChangePromise;
		}
		let next: Promise<void>;
		next = (async () => {
			if (modeChangePromise) {
				await modeChangePromise;
			}
			await sessionRuntime.ensureReady();
			await sessionRuntime.applyMode(mode);
		})().finally(() => {
			if (modeChangePromise === next) {
				modeChangePromise = undefined;
				modeChangeTarget = undefined;
			}
		});
		modeChangePromise = next;
		modeChangeTarget = mode;
		return next;
	};

	const waitForSubmittedMode = async (mode: unknown): Promise<void> => {
		if (!isInteractiveMode(mode)) return;
		if (modeChangePromise) {
			await modeChangePromise;
		}
		if (config.mode !== mode) {
			await applyModeChange(mode);
		}
	};

	let isRunning = false;
	setActiveRuntimeAbort(sessionRuntime.abortAll);

	let cleanupPromise: Promise<InteractiveExitSummary | undefined> | undefined;

	const handleSigint = () => {
		if (isRunning) {
			if (sessionRuntime.abortAll()) {
				return;
			}
			void cleanupRuntime().finally(() => {
				process.exitCode = 0;
				tuiApp?.destroy();
			});
			return;
		}
		tuiApp?.destroy();
	};
	const handleSigterm = () => {
		if (isRunning) {
			sessionRuntime.abortAll();
			return;
		}
		tuiApp?.destroy();
	};
	const cleanupRuntime = async (): Promise<
		InteractiveExitSummary | undefined
	> => {
		if (cleanupPromise) {
			return await cleanupPromise;
		}
		cleanupPromise = (async () => {
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
			const exitSummary = await sessionRuntime.cleanup();
			setActiveRuntimeAbort(undefined);
			setActiveRuntimeCleanup(undefined);
			return exitSummary;
		})();
		return await cleanupPromise;
	};
	let sessionPolicyRefresh: Promise<void> | undefined;
	let pendingSessionPolicyRefresh = false;
	const refreshInteractiveSessionPolicies = async (): Promise<void> => {
		if (sessionRuntime.isShutdownRequested()) {
			return;
		}
		if (isRunning) {
			pendingSessionPolicyRefresh = true;
			return;
		}
		if (sessionPolicyRefresh) {
			return await sessionPolicyRefresh;
		}
		pendingSessionPolicyRefresh = false;
		sessionPolicyRefresh = (async () => {
			await sessionRuntime.ensureReady();
			if (isRunning || sessionRuntime.isShutdownRequested()) {
				pendingSessionPolicyRefresh = isRunning;
				return;
			}
			await sessionRuntime.restartWithCurrentMessages();
		})()
			.catch((error) => {
				logCliError(config.logger, "Interactive policy refresh failed", {
					error,
				});
				writeErr(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				sessionPolicyRefresh = undefined;
			});
		return await sessionPolicyRefresh;
	};
	const refreshInteractiveSessionPoliciesIfPending = (): void => {
		if (pendingSessionPolicyRefresh) {
			void refreshInteractiveSessionPolicies();
		}
	};

	const shouldRefreshInteractiveSessionForConfigItem = (
		item: InteractiveConfigItem,
	): boolean =>
		item.kind === "tool" ||
		item.kind === "plugin" ||
		item.kind === "skill" ||
		item.kind === "mcp";

	const onToggleConfigItem = async (
		item: InteractiveConfigItem,
	): Promise<
		Awaited<ReturnType<typeof configDataLoader.onToggleConfigItem>>
	> => {
		const data = await configDataLoader.onToggleConfigItem(item);
		if (data && shouldRefreshInteractiveSessionForConfigItem(item)) {
			await refreshInteractiveSessionPolicies();
		}
		return data;
	};
	const toQueuedPromptItem = (prompt: {
		id: string;
		prompt: string;
		delivery: "queue" | "steer";
		attachmentCount: number;
	}): QueuedPromptItem => ({
		id: prompt.id,
		prompt: prompt.prompt,
		steer: prompt.delivery === "steer",
		attachmentCount: prompt.attachmentCount,
	});

	process.on("SIGINT", handleSigint);
	process.on("SIGTERM", handleSigterm);

	disableOpenTuiGraphicsProbe();
	const { renderOpenTui } = await import("../tui/index");

	// eslint-disable-next-line prefer-const
	let tuiApp: Awaited<ReturnType<typeof renderOpenTui>> | undefined;
	setActiveRuntimeCleanup(() => {
		tuiApp?.destroy();
	});
	let startupErrorReported = false;
	const loadDeferredInitialMessages = resumeSessionId?.trim()
		? async () => {
				try {
					await sessionRuntime.ensureReady();
					const messages = await sessionRuntime.readCurrentMessages();
					const usage = await sessionRuntime.getAccumulatedUsage({
						inputTokens: 0,
						outputTokens: 0,
					});
					return {
						messages,
						totalCost: usage.totalCost,
						currentContextSize: getCurrentContextSize(messages),
					};
				} catch (error) {
					startupErrorReported = true;
					logCliError(config.logger, "Interactive startup failed", { error });
					throw error;
				}
			}
		: undefined;

	tuiApp = await renderOpenTui({
		config,
		initialView: options?.initialView,
		initialPrompt: options?.initialPrompt,
		initialNotice: options?.initialNotice,
		onInitialNoticeShown: options?.onInitialNoticeShown,
		loadDeferredInitialMessages,
		initialRepoStatus,
		workflowSlashCommands,
		loadAdditionalSlashCommands,
		loadWelcomeLine: async () =>
			await resolveClineWelcomeLine({
				config,
				clineApiBaseUrl: options?.clineApiBaseUrl,
				clineProviderSettings: options?.clineProviderSettings,
			}),
		loadClineAccount: async () =>
			await loadClineAccountSnapshot({
				config,
				clineApiBaseUrl: options?.clineApiBaseUrl,
			}),
		switchClineAccount: async (organizationId) =>
			await switchClineAccount({
				config,
				organizationId,
				clineApiBaseUrl: options?.clineApiBaseUrl,
			}),
		loadConfigData: configDataLoader.loadConfigData,
		onToggleConfigItem,
		subscribeToEvents: ({
			onAgentEvent: onAgent,
			onTeamEvent: onTeam,
			onPendingPrompts,
			onPendingPromptSubmitted,
		}) => {
			uiEvents.on("agent", onAgent);
			uiEvents.on("team", onTeam);
			uiEvents.on("pending-prompts", onPendingPrompts);
			uiEvents.on("pending-prompt-submitted", onPendingPromptSubmitted);
			return () => {
				uiEvents.off("agent", onAgent);
				uiEvents.off("team", onTeam);
				uiEvents.off("pending-prompts", onPendingPrompts);
				uiEvents.off("pending-prompt-submitted", onPendingPromptSubmitted);
			};
		},
		onSubmit: async (input, mode, delivery, attachments) => {
			try {
				await sessionRuntime.ensureReady();
				await waitForSubmittedMode(mode);
				sessionRuntime.resetAbortRequest();
				if (!delivery) {
					isRunning = true;
				}

				const chatCommandResult = await runInteractiveChatCommand({
					prompt: input,
					enabled: enableChatCommands,
					config,
					host: interactiveChatCommandHost,
					chatCommandState,
					autoApproveAllRef,
					setInteractiveAutoApprove,
					sessionRuntime,
					stop: () => tuiApp?.destroy(),
				});
				if (chatCommandResult.handled) {
					return chatCommandResult.turnResult;
				}
				input = chatCommandResult.input;
				const {
					prompt: userInput,
					userImages,
					userFiles,
				} = await buildUserInputMessage(input, userInstructionService);
				const mergedUserImages = [
					...(attachments?.userImages ?? []),
					...userImages,
				];

				const applyPendingModeChange = async () => {
					if (!pendingModeChange.current) return undefined;
					const newMode = pendingModeChange.current;
					pendingModeChange.current = null;
					await sessionRuntime.applyMode(newMode);
					tuiModeChanged.current?.(newMode);
					return newMode;
				};

				const result = await sessionRuntime.sendCurrentTurn({
					prompt: userInput,
					mode,
					userImages:
						mergedUserImages.length > 0 ? mergedUserImages : undefined,
					userFiles: userFiles.length > 0 ? userFiles : undefined,
					delivery,
				});

				await applyPendingModeChange();

				if (!result) {
					return {
						usage: { inputTokens: 0, outputTokens: 0 },
						iterations: 0,
						finishReason: "queued",
						queued: delivery === "queue" || delivery === "steer",
					};
				}
				if (result.finishReason !== "completed") {
					if (result.finishReason === "aborted" || isAbortInProgress()) {
						const usage = await sessionRuntime.getAccumulatedUsage(
							result.usage,
						);
						return {
							usage,
							currentContextSize: getCurrentContextSize(result.messages),
							iterations: result.iterations,
							finishReason: "aborted",
						};
					}
					const errorText = result.text.trim();
					throw new Error(
						errorText || `Turn finished with ${result.finishReason}`,
					);
				}
				const usage = await sessionRuntime.getAccumulatedUsage(result.usage);
				return {
					usage,
					currentContextSize: getCurrentContextSize(result.messages),
					iterations: result.iterations,
					finishReason: result.finishReason,
				};
			} catch (error) {
				if (isAbortInProgress()) {
					return {
						usage: { inputTokens: 0, outputTokens: 0 },
						iterations: 0,
						finishReason: "aborted",
					};
				}
				logCliError(config.logger, "Interactive turn failed", {
					error,
					sessionId: sessionRuntime.getActiveSessionId() || undefined,
					delivery,
				});
				throw error;
			} finally {
				if (!delivery) {
					isRunning = false;
					clearAbortInProgress();
					refreshInteractiveSessionPoliciesIfPending();
				}
			}
		},
		onUpdatePendingPrompt: async (update) => {
			await sessionRuntime.ensureReady();
			const result = await sessionRuntime.updatePendingPrompt(update);
			return {
				sessionId: result.sessionId,
				prompts: result.prompts.map(toQueuedPromptItem),
				prompt: result.prompt ? toQueuedPromptItem(result.prompt) : undefined,
				updated: result.updated,
				removed: result.removed,
			};
		},
		onAbort: () => {
			return sessionRuntime.abortAll();
		},
		onExit: () => {
			tuiApp?.destroy();
		},
		onRunningChange: (running) => {
			isRunning = running;
			if (!running) {
				sessionRuntime.resetAbortRequest();
				refreshInteractiveSessionPoliciesIfPending();
			}
		},
		onTurnErrorReported: () => {},
		onAutoApproveChange: (enabled) => {
			setInteractiveAutoApprove(enabled);
			void refreshInteractiveSessionPolicies();
		},
		onCompactionModeChange: async (mode) => {
			await sessionRuntime.ensureReady();
			applyCliCompactionMode(config, mode);
			await sessionRuntime.restartWithCurrentMessages();
		},
		onModeChange: async (mode) => {
			if (!isInteractiveMode(mode)) return;
			if (isRunning) {
				pendingModeChange.current = mode;
				sessionRuntime.abortAll();
				return;
			}
			await applyModeChange(mode);
		},
		onModelChange: async () => {
			await sessionRuntime.ensureReady();
			const existing = providerSettingsManager.getProviderSettings(
				config.providerId,
			) ?? {
				provider: config.providerId,
			};
			providerSettingsManager.saveProviderSettings({
				...existing,
				model: config.modelId,
				reasoning: config.reasoningEffort
					? { enabled: true, effort: config.reasoningEffort }
					: { enabled: false },
			});
			await sessionRuntime.restartWithCurrentMessages();
		},
		onSessionRestart: async () => {
			await sessionRuntime.ensureReady();
			await sessionRuntime.restartEmpty();
		},
		onAccountChange: async () => {
			await sessionRuntime.ensureReady();
			await sessionRuntime.restartWithCurrentMessages();
		},
		onResumeSession: async (sessionId: string) => {
			await sessionRuntime.ensureReady();
			const messages = await sessionRuntime.resumeSession(sessionId);
			const usage = await sessionRuntime.getAccumulatedUsage({
				inputTokens: 0,
				outputTokens: 0,
			});
			return {
				messages,
				totalCost: usage.totalCost,
				currentContextSize: getCurrentContextSize(messages),
			};
		},
		onCompact: async () => {
			await sessionRuntime.ensureReady();
			return await sessionRuntime.compactCurrentSession();
		},
		onFork: async () => {
			await sessionRuntime.ensureReady();
			return await sessionRuntime.forkCurrentSession();
		},
		getCheckpointData: async () => {
			await sessionRuntime.ensureReady();
			return await sessionRuntime.getCheckpointData();
		},
		onRestoreCheckpoint: async (runCount, restoreWorkspace) => {
			await sessionRuntime.ensureReady();
			return await sessionRuntime.restoreCheckpoint(runCount, restoreWorkspace);
		},
		setToolApprover: (fn) => {
			tuiToolApprover.current = fn;
		},
		setAskQuestion: (fn) => {
			tuiAskQuestion.current = fn;
		},
		setModeChangeNotifier: (fn) => {
			tuiModeChanged.current = fn;
		},
	});

	if (!loadDeferredInitialMessages) {
		setTimeout(() => {
			void sessionRuntime.ensureReady().catch((error) => {
				if (sessionRuntime.isShutdownRequested() || startupErrorReported) {
					return;
				}
				startupErrorReported = true;
				logCliError(config.logger, "Interactive startup failed", { error });
				writeErr(error instanceof Error ? error.message : String(error));
				tuiApp?.destroy();
			});
		}, 0);
	}

	let exitSummary: InteractiveExitSummary | undefined;
	try {
		await tuiApp.waitUntilExit();
	} finally {
		exitSummary = await cleanupRuntime();
	}
	if (exitSummary) {
		prepareTerminalForPostTuiOutput();
		writeln(formatInteractiveExitSummary(exitSummary));
	}
}
