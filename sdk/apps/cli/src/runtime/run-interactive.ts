import {
	type ProviderSettings,
	ProviderSettingsManager,
	prewarmFileIndex,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";
import type { Message } from "@clinebot/shared";
import { logCliError } from "../logging/errors";
import {
	loadClineAccountSnapshot,
	switchClineAccount,
} from "../tui/cline-account";
import {
	type InteractiveSlashCommand,
	listInteractiveSlashCommands,
	resolveClineWelcomeLine,
} from "../tui/interactive-welcome";
import { disableOpenTuiGraphicsProbe } from "../tui/opentui-env";
import { type ChatCommandState, chatCommandHost } from "../utils/chat-commands";
import { writeErr } from "../utils/output";
import { createWorkspaceChatCommandHost } from "../utils/plugin-chat-commands";
import { readRepoStatus } from "../utils/repo-status";
import type { Config } from "../utils/types";
import {
	setActiveRuntimeAbort,
	setActiveRuntimeCleanup,
} from "./active-runtime";
import { createInteractiveApprovalController } from "./interactive/approvals";
import { runInteractiveChatCommand } from "./interactive/chat-command-runner";
import { createInteractiveConfigDataLoader } from "./interactive/config-data";
import { createMistakeLimitDecisionResolver } from "./interactive/mistakes";
import { createInteractiveModeSwitchTool } from "./interactive/mode";
import { assertInteractivePreflight } from "./interactive/preflight";
import { createInteractiveSessionRuntime } from "./interactive/session-runtime";
import { buildUserInputMessage } from "./prompt";
import { getUIEventEmitter } from "./session-events";

export async function runInteractive(
	config: Config,
	userInstructionWatcher?: UserInstructionConfigWatcher,
	resumeSessionId?: string,
	options?: {
		clineApiBaseUrl?: string;
		clineProviderSettings?: ProviderSettings;
		initialView?: "chat" | "config";
		initialPrompt?: string;
	},
): Promise<void> {
	assertInteractivePreflight(config);

	const initialRepoStatus = await readRepoStatus(config.cwd);
	void prewarmFileIndex(config.cwd);
	const workflowSlashCommands = listInteractiveSlashCommands(
		userInstructionWatcher,
	);
	let interactiveChatCommandHost = chatCommandHost;
	const configDataLoader = createInteractiveConfigDataLoader({
		config,
		userInstructionWatcher,
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

	const sessionRuntime = createInteractiveSessionRuntime({
		config,
		userInstructionWatcher,
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

	let isRunning = false;
	setActiveRuntimeAbort(sessionRuntime.abortAll);

	let cleanupPromise: Promise<void> | undefined;

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
	const cleanupRuntime = async () => {
		if (cleanupPromise) {
			return await cleanupPromise;
		}
		cleanupPromise = (async () => {
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
			await sessionRuntime.cleanup();
			setActiveRuntimeAbort(undefined);
			setActiveRuntimeCleanup(undefined);
		})();
		return await cleanupPromise;
	};
	let sessionPolicyRefresh: Promise<void> | undefined;
	const refreshInteractiveSessionPolicies = (): void => {
		if (
			isRunning ||
			sessionRuntime.isShutdownRequested() ||
			sessionPolicyRefresh
		) {
			return;
		}
		sessionPolicyRefresh = (async () => {
			await sessionRuntime.ensureReady();
			if (isRunning || sessionRuntime.isShutdownRequested()) {
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
	};

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
		? async (): Promise<Message[]> => {
				try {
					await sessionRuntime.ensureReady();
					return await sessionRuntime.readCurrentMessages();
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
		onToggleConfigItem: configDataLoader.onToggleConfigItem,
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
		onSubmit: async (input, _mode, delivery, attachments) => {
			try {
				await sessionRuntime.ensureReady();
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
				} = await buildUserInputMessage(input, userInstructionWatcher);
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
					if (result.finishReason === "aborted") {
						return {
							usage: result.usage,
							iterations: result.iterations,
							finishReason: result.finishReason,
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
					iterations: result.iterations,
					finishReason: result.finishReason,
				};
			} catch (error) {
				logCliError(config.logger, "Interactive turn failed", {
					error,
					sessionId: sessionRuntime.getActiveSessionId() || undefined,
					delivery,
				});
				throw error;
			} finally {
				if (!delivery) {
					isRunning = false;
				}
			}
		},
		onAbort: () => {
			return sessionRuntime.abortAll();
		},
		onExit: () => {
			tuiApp?.destroy();
		},
		onRunningChange: (running) => {
			isRunning = running;
		},
		onTurnErrorReported: () => {},
		onAutoApproveChange: (enabled) => {
			setInteractiveAutoApprove(enabled);
			refreshInteractiveSessionPolicies();
		},
		onModeChange: async (mode) => {
			await sessionRuntime.ensureReady();
			if (mode !== "plan" && mode !== "act") {
				return;
			}
			await sessionRuntime.applyMode(mode);
		},
		onModelChange: async () => {
			await sessionRuntime.ensureReady();
			const manager = new ProviderSettingsManager();
			const existing = manager.getProviderSettings(config.providerId) ?? {
				provider: config.providerId,
			};
			manager.saveProviderSettings({
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
			return await sessionRuntime.resumeSession(sessionId);
		},
		onCompact: async () => {
			await sessionRuntime.ensureReady();
			return await sessionRuntime.compactCurrentSession();
		},
		onFork: async () => {
			await sessionRuntime.ensureReady();
			return await sessionRuntime.forkCurrentSession();
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

	try {
		await tuiApp.waitUntilExit();
	} finally {
		await cleanupRuntime();
	}
}
