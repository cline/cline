import {
	type AgentEvent,
	type ProviderSettings,
	prewarmFileIndex,
	SessionSource,
	type TeamEvent,
	toggleDisabledTool,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";
import { render } from "ink";
import React from "react";
import { logCliError } from "../logging/errors";
import { createCliCore } from "../session/session";
import {
	formatPreviewMessageText,
	getLastSessionPreviewMessages,
} from "../session/session-message-summary";
import { loadInteractiveConfigData } from "../tui/interactive-config";
import { InteractiveTui } from "../tui/interactive-tui";
import {
	type InteractiveSlashCommand,
	listInteractiveSlashCommands,
	resolveClineWelcomeLine,
} from "../tui/interactive-welcome";
import {
	askQuestionInTerminal,
	requestToolApproval,
	submitAndExitInTerminal,
} from "../utils/approval";
import {
	type ChatCommandState,
	chatCommandHost,
	type ForkSessionResult,
	maybeHandleChatCommand,
} from "../utils/chat-commands";
import { createRuntimeHooks } from "../utils/hooks";
import { c, setActiveCliSession, writeErr, writeln } from "../utils/output";
import { createWorkspaceChatCommandHost } from "../utils/plugin-chat-commands";
import { loadInteractiveResumeMessages } from "../utils/resume";
import {
	enableTeamsForPrompt,
	rewriteTeamPrompt,
	TEAM_COMMAND_USAGE,
} from "../utils/team-command";
import type { Config } from "../utils/types";
import { setActiveRuntimeAbort } from "./active-runtime";
import {
	CLI_DEFAULT_CHECKPOINT_CONFIG,
	CLI_DEFAULT_LOOP_DETECTION,
} from "./defaults";
import { buildUserInputMessage } from "./prompt";
import type {
	PendingPromptSnapshot,
	PendingPromptSubmittedEvent,
} from "./session-events";
import {
	getUIEventEmitter,
	subscribeToAgentEvents,
	subscribeToPendingPromptEvents,
} from "./session-events";
import {
	applyInteractiveAutoApproveOverride,
	cloneToolPolicies,
} from "./tool-policies";

export async function runInteractive(
	config: Config,
	userInstructionWatcher?: UserInstructionConfigWatcher,
	resumeSessionId?: string,
	options?: {
		clineApiBaseUrl?: string;
		clineProviderSettings?: ProviderSettings;
		initialView?: "chat" | "config";
	},
): Promise<void> {
	if (config.outputMode === "json") {
		writeErr("interactive mode is not supported with --json");
		process.exit(1);
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		writeErr(
			"interactive mode requires a TTY (stdin/stdout must both be terminals)",
		);
		process.exit(1);
	}

	void prewarmFileIndex(config.cwd);
	const workflowSlashCommands = listInteractiveSlashCommands(
		userInstructionWatcher,
	);
	let interactiveChatCommandHost = chatCommandHost;
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

	const enableChatCommands = process.env.CLINE_ENABLE_CHAT_COMMANDS === "1";
	const autoApproveAllRef = {
		current: config.toolPolicies["*"]?.autoApprove !== false,
	};
	const baselineToolPolicies = cloneToolPolicies(config.toolPolicies);
	const setInteractiveAutoApprove = (enabled: boolean) => {
		autoApproveAllRef.current = enabled;
		config.defaultToolAutoApprove = enabled;
		applyInteractiveAutoApproveOverride({
			targetPolicies: config.toolPolicies,
			baselinePolicies: baselineToolPolicies,
			enabled,
		});
	};

	const uiEvents = getUIEventEmitter();
	const chatCommandState: ChatCommandState = {
		enableTools: config.enableTools,
		autoApproveTools: autoApproveAllRef.current,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot?.trim() || config.cwd,
	};
	const resolveMistakeLimitDecision = async (context: {
		iteration: number;
		consecutiveMistakes: number;
		maxConsecutiveMistakes: number;
		reason: "api_error" | "invalid_tool_call" | "tool_execution_failed";
		details?: string;
	}) => {
		if (autoApproveAllRef.current) {
			return {
				action: "stop" as const,
				reason: `max consecutive mistakes reached (${context.maxConsecutiveMistakes}) in yolo mode`,
			};
		}
		const detail = context.details?.trim();
		const summary = detail
			? `${context.reason}: ${detail}`
			: `${context.reason} at iteration ${context.iteration}`;
		const answer = await askQuestionInTerminal(
			`mistake_limit_reached (${context.consecutiveMistakes}/${context.maxConsecutiveMistakes})\nLatest: ${summary}\nHow should Cline continue?`,
			["Try a different approach", "Stop this run"],
		);
		const normalized = answer.trim().toLowerCase();
		if (
			normalized === "2" ||
			normalized === "stop this run" ||
			normalized === "stop" ||
			normalized === "n" ||
			normalized === "no"
		) {
			return {
				action: "stop" as const,
				reason: "stopped after mistake_limit_reached prompt",
			};
		}
		if (
			normalized === "1" ||
			normalized === "try a different approach" ||
			normalized.length === 0
		) {
			return {
				action: "continue" as const,
				guidance:
					"mistake_limit_reached: retry with a different approach, validate tool parameters before calls, and avoid repeating failed steps.",
			};
		}
		return {
			action: "continue" as const,
			guidance: `mistake_limit_reached: ${answer.trim()}`,
		};
	};
	let sessionManager: Awaited<ReturnType<typeof createCliCore>> | undefined;
	let runtimeHooks: ReturnType<typeof createRuntimeHooks> | undefined;
	let unsubscribeAgent = () => {};
	let unsubscribePendingPrompts = () => {};
	let startupPromise: Promise<void> | undefined;
	let startupError: unknown;
	let shutdownRequested = false;
	// Tracks the session that is currently live for send/abort/stop operations.
	let activeSessionId = "";
	// One-time startup input: when present, the first interactive session
	// reuses this historical id instead of allocating a new one.
	const initialResumeSessionId = resumeSessionId?.trim() || undefined;
	const applyStartedSession = (
		started: NonNullable<
			Awaited<ReturnType<typeof createCliCore>>
		> extends infer T
			? T extends { start: (...args: never[]) => Promise<infer R> }
				? R
				: never
			: never,
	) => {
		setActiveCliSession({
			manifestPath: started.manifestPath,
			messagesPath: started.messagesPath,
			manifest: started.manifest,
		});
		activeSessionId = started.sessionId;
	};
	const ensureSessionManager = async () => {
		if (sessionManager) {
			return sessionManager;
		}
		const manager = await createCliCore({
			defaultToolExecutors: {
				askQuestion: askQuestionInTerminal,
				submit: submitAndExitInTerminal,
			},
			forceLocalBackend: config.mode === "yolo" || config.sandbox === true,
			logger: config.logger,
			toolPolicies: config.toolPolicies,
			requestToolApproval: async (request) => {
				if (autoApproveAllRef.current) {
					return { approved: true };
				}
				return requestToolApproval(request);
			},
		});
		if (shutdownRequested) {
			await manager.dispose("cli_interactive_startup_cancelled");
			throw new Error("interactive runtime shutdown requested");
		}
		sessionManager = manager;
		runtimeHooks = createRuntimeHooks({
			verbose: config.verbose,
			yolo: config.mode === "yolo",
			cwd: config.cwd,
			workspaceRoot: config.workspaceRoot,
			dispatchHookEvent: async (payload) => {
				await manager.handleHookEvent(payload);
			},
		});
		const onAgentEvent = (event: AgentEvent): void => {
			uiEvents.emit("agent", event);
		};
		unsubscribeAgent = subscribeToAgentEvents(manager, onAgentEvent);
		unsubscribePendingPrompts = subscribeToPendingPromptEvents(manager, {
			onPendingPrompts: (event: PendingPromptSnapshot): void => {
				uiEvents.emit("pending-prompts", event);
			},
			onPendingPromptSubmitted: (event: PendingPromptSubmittedEvent): void => {
				uiEvents.emit("pending-prompt-submitted", event);
			},
		});
		return manager;
	};
	/**
	 * Starts a brand-new interactive session. This path is used for normal boot
	 * when we are not resuming, and for later reset/new-session flows where we
	 * intentionally want a fresh session id.
	 */
	const startFreshSession = async (
		initial: Awaited<ReturnType<typeof loadInteractiveResumeMessages>> = [],
		sessionMetadata?: Record<string, unknown>,
	) => {
		const manager = await ensureSessionManager();
		if (!runtimeHooks) {
			throw new Error("interactive runtime hooks are unavailable");
		}
		const started = await manager.start({
			source: SessionSource.CLI,
			config: {
				...config,
				execution: {
					...config.execution,
					loopDetection:
						config.execution?.loopDetection ?? CLI_DEFAULT_LOOP_DETECTION,
				},
				checkpoint: config.checkpoint ?? CLI_DEFAULT_CHECKPOINT_CONFIG,
				enableTools: chatCommandState.enableTools,
				cwd: chatCommandState.cwd,
				workspaceRoot: chatCommandState.workspaceRoot,
				hooks: runtimeHooks.hooks,
				onTeamEvent: (event: TeamEvent): void => {
					uiEvents.emit("team", event);
				},
				onConsecutiveMistakeLimitReached: resolveMistakeLimitDecision,
			},
			interactive: true,
			initialMessages: initial,
			...(sessionMetadata ? { sessionMetadata } : {}),
			localRuntime: {
				userInstructionWatcher,
				onTeamRestored: () => {},
			},
		});
		applyStartedSession(started);
	};

	/**
	 * Forks the current active session by copying its full message history and
	 * checkpoint metadata into a brand-new session. The new session's persisted
	 * metadata records the origin session id, source, and any checkpoint history
	 * so the lineage can be traced back.
	 */
	const forkCurrentSession = async (): Promise<
		ForkSessionResult | undefined
	> => {
		const manager = sessionManager;
		if (!manager || !activeSessionId) {
			return undefined;
		}
		const forkedFromSessionId = activeSessionId;
		// Read the current session record so we can copy checkpoint metadata.
		const sessionRecord = await manager.get(forkedFromSessionId);
		// Read the full message history from the source session.
		const messages = await manager
			.readMessages(forkedFromSessionId)
			.catch(() => undefined);
		if (!messages) {
			return undefined;
		}
		if (messages.length === 0) {
			throw new Error("Cannot fork an empty session.");
		}
		// Stop the current session before starting the fork so the two sessions
		// do not share the same in-process state.
		await manager.stop(forkedFromSessionId);
		// Build fork lineage metadata. We copy any existing checkpoint metadata
		// from the original session so the forked session knows what checkpoints
		// were present at the time of the fork.
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
		// Preserve any other existing metadata fields from the original session
		// so nothing is lost (e.g. title, totalCost).
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
	/**
	 * Starts the initial interactive session by continuing an existing historical
	 * session id. This is only used once during startup when `--resume` selected
	 * a session; later reset/new-session flows use `startFreshSession()` instead.
	 */
	const startResumedSession = async (
		resumeId: string,
		initial: Awaited<ReturnType<typeof loadInteractiveResumeMessages>>,
	) => {
		const manager = await ensureSessionManager();
		if (!runtimeHooks) {
			throw new Error("interactive runtime hooks are unavailable");
		}
		const started = await manager.start({
			source: SessionSource.CLI,
			config: {
				...config,
				execution: {
					...config.execution,
					loopDetection:
						config.execution?.loopDetection ?? CLI_DEFAULT_LOOP_DETECTION,
				},
				checkpoint: config.checkpoint ?? CLI_DEFAULT_CHECKPOINT_CONFIG,
				sessionId: resumeId,
				enableTools: chatCommandState.enableTools,
				cwd: chatCommandState.cwd,
				workspaceRoot: chatCommandState.workspaceRoot,
				hooks: runtimeHooks.hooks,
				onTeamEvent: (event: TeamEvent): void => {
					uiEvents.emit("team", event);
				},
				onConsecutiveMistakeLimitReached: resolveMistakeLimitDecision,
			},
			interactive: true,
			initialMessages: initial,
			localRuntime: {
				userInstructionWatcher,
				onTeamRestored: () => {},
			},
		});
		applyStartedSession(started);
	};
	const ensureInteractiveRuntimeReady = async (): Promise<void> => {
		if (startupPromise) {
			return await startupPromise;
		}
		startupPromise = (async () => {
			const manager = await ensureSessionManager();
			const initialMessages = await loadInteractiveResumeMessages(
				manager,
				resumeSessionId,
			);
			if (resumeSessionId?.trim()) {
				const previewMessages = getLastSessionPreviewMessages(
					initialMessages ?? [],
					2,
				);
				if (previewMessages.length > 0) {
					writeln(
						`${c.dim}Resuming ${resumeSessionId.trim()} with recent context:${c.reset}`,
					);
					for (const previewMessage of previewMessages) {
						writeln(
							`${c.dim}${formatPreviewMessageText(previewMessage)}${c.reset}`,
						);
					}
					writeln();
				}
			}
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

	let isRunning = false;
	let abortRequested = false;
	const abortAll = () => {
		if (abortRequested || !sessionManager || !activeSessionId) {
			return false;
		}
		abortRequested = true;
		sessionManager
			.abort(activeSessionId, new Error("Interactive runtime abort requested"))
			.catch(() => {});
		return true;
	};
	setActiveRuntimeAbort(abortAll);

	let unmountInteractiveUi: (() => void) | undefined;
	const requestExit = () => {
		if (!unmountInteractiveUi) {
			return;
		}
		const close = unmountInteractiveUi;
		unmountInteractiveUi = undefined;
		close();
	};
	let cleanupPromise: Promise<void> | undefined;

	const handleSigint = () => {
		if (isRunning) {
			if (abortAll()) {
				return;
			}
			void cleanupRuntime().finally(() => {
				process.exitCode = 0;
				process.exit(0);
			});
			return;
		}
		requestExit();
	};
	const handleSigterm = () => {
		if (isRunning) {
			abortAll();
			return;
		}
		requestExit();
	};
	const cleanupRuntime = async () => {
		if (cleanupPromise) {
			return await cleanupPromise;
		}
		cleanupPromise = (async () => {
			shutdownRequested = true;
			requestExit();
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
			try {
				await startupPromise?.catch(() => {});
			} finally {
				unsubscribeAgent();
				unsubscribePendingPrompts();
			}
			try {
				if (sessionManager && activeSessionId) {
					await sessionManager.stop(activeSessionId);
				}
			} finally {
				try {
					if (sessionManager) {
						await sessionManager.dispose("cli_interactive_shutdown");
					}
				} finally {
					await runtimeHooks?.shutdown();
				}
			}
			setActiveRuntimeAbort(undefined);
		})();
		return await cleanupPromise;
	};

	process.on("SIGINT", handleSigint);
	process.on("SIGTERM", handleSigterm);

	const inkApp = render(
		React.createElement(InteractiveTui, {
			config,
			initialView: options?.initialView ?? "chat",
			workflowSlashCommands,
			loadAdditionalSlashCommands,
			loadWelcomeLine: async () =>
				await resolveClineWelcomeLine({
					config,
					clineApiBaseUrl: options?.clineApiBaseUrl,
					clineProviderSettings: options?.clineProviderSettings,
				}),
			loadConfigData: async () =>
				loadInteractiveConfigData({
					watcher: userInstructionWatcher,
					cwd: config.cwd,
					workspaceRoot: config.workspaceRoot?.trim() || config.cwd,
					availabilityContext: {
						mode: config.mode,
						modelId: config.modelId,
						providerId: config.providerId,
						enableSpawnAgent: config.enableSpawnAgent,
						enableAgentTeams: config.enableAgentTeams,
					},
				}),
			onToggleConfigItem: async (item) => {
				if (
					item.source !== "workspace-plugin" &&
					item.source !== "global-plugin"
				) {
					return undefined;
				}
				toggleDisabledTool(item.name);
				return await loadInteractiveConfigData({
					watcher: userInstructionWatcher,
					cwd: config.cwd,
					workspaceRoot: config.workspaceRoot?.trim() || config.cwd,
					availabilityContext: {
						mode: config.mode,
						modelId: config.modelId,
						providerId: config.providerId,
						enableSpawnAgent: config.enableSpawnAgent,
						enableAgentTeams: config.enableAgentTeams,
					},
				});
			},
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
			onSubmit: async (input, _mode, delivery) => {
				try {
					await ensureInteractiveRuntimeReady();
					abortRequested = false;
					if (!delivery) {
						isRunning = true;
					}
					// Handle /team command: transform the input and ensure
					// teams are enabled for the current session.
					const rewrittenTeamPrompt = rewriteTeamPrompt(input);
					if (rewrittenTeamPrompt.kind !== "none") {
						if (rewrittenTeamPrompt.kind === "usage") {
							return {
								usage: { inputTokens: 0, outputTokens: 0 },
								iterations: 0,
								commandOutput: TEAM_COMMAND_USAGE,
							};
						}
						// Enable teams on the config so the next session picks it up.
						if (!config.enableAgentTeams) {
							await enableTeamsForPrompt(config);
							// Restart the session with teams enabled.
							if (sessionManager && activeSessionId) {
								await sessionManager.stop(activeSessionId);
							}
							await startFreshSession([]);
						}
						input = rewrittenTeamPrompt.prompt;
					}

					let commandOutput: string | undefined;
					if (
						await maybeHandleChatCommand(input, {
							enabled: enableChatCommands,
							host: interactiveChatCommandHost,
							getState: () => ({
								...chatCommandState,
								autoApproveTools: autoApproveAllRef.current,
							}),
							setState: async (next) => {
								chatCommandState.enableTools = next.enableTools;
								chatCommandState.autoApproveTools = next.autoApproveTools;
								chatCommandState.cwd = next.cwd;
								chatCommandState.workspaceRoot = next.workspaceRoot;
								setInteractiveAutoApprove(next.autoApproveTools);
							},
							reply: async (text) => {
								commandOutput = text;
							},
							reset: async () => {
								if (sessionManager && activeSessionId) {
									await sessionManager.stop(activeSessionId);
								}
								await startFreshSession([]);
							},
							stop: async () => {
								requestExit();
							},
							describe: () =>
								[
									`sessionId=${activeSessionId}`,
									`tools=${chatCommandState.enableTools ? "on" : "off"}`,
									`yolo=${autoApproveAllRef.current ? "on" : "off"}`,
									`cwd=${chatCommandState.cwd}`,
									`workspaceRoot=${chatCommandState.workspaceRoot}`,
								].join("\n"),
							fork: forkCurrentSession,
						})
					) {
						return {
							usage: {
								inputTokens: 0,
								outputTokens: 0,
							},
							iterations: 0,
							commandOutput,
						};
					}
					const {
						prompt: userInput,
						userImages,
						userFiles,
					} = await buildUserInputMessage(input, userInstructionWatcher);
					if (!sessionManager) {
						throw startupError instanceof Error
							? startupError
							: new Error("interactive session manager is unavailable");
					}
					const result = await sessionManager.send({
						sessionId: activeSessionId,
						prompt: userInput,
						userImages: userImages.length > 0 ? userImages : undefined,
						userFiles: userFiles.length > 0 ? userFiles : undefined,
						delivery,
					});
					if (!result) {
						return {
							usage: {
								inputTokens: 0,
								outputTokens: 0,
							},
							iterations: 0,
							queued: delivery === "queue" || delivery === "steer",
						};
					}
					const usage =
						(await sessionManager.getAccumulatedUsage(activeSessionId)) ??
						result.usage;
					return {
						usage,
						iterations: result.iterations,
					};
				} catch (error) {
					logCliError(config.logger, "Interactive turn failed", {
						error,
						sessionId: activeSessionId || undefined,
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
				abortAll();
			},
			onExit: requestExit,
			onRunningChange: (running) => {
				isRunning = running;
			},
			onTurnErrorReported: () => {
				// Interactive TUI handles turn-scoped error rendering.
			},
			onAutoApproveChange: (enabled) => {
				setInteractiveAutoApprove(enabled);
			},
		}),
		{ exitOnCtrlC: false },
	);
	void ensureInteractiveRuntimeReady().catch((error) => {
		if (shutdownRequested) {
			return;
		}
		logCliError(config.logger, "Interactive startup failed", { error });
		writeErr(error instanceof Error ? error.message : String(error));
		requestExit();
	});
	unmountInteractiveUi = () => {
		try {
			inkApp.unmount();
		} catch {
			// no-op: already unmounted
		}
	};

	try {
		await inkApp.waitUntilExit();
	} finally {
		await cleanupRuntime();
	}
}
