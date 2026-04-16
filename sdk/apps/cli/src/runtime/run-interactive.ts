import {
	type AgentEvent,
	type Llms,
	prewarmFileIndex,
	SessionSource,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";
import { render } from "ink";
import React from "react";
import { createCliCore } from "../session/session";
import {
	formatPreviewMessageText,
	getLastSessionPreviewMessages,
} from "../session/session-message-summary";
import {
	askQuestionInTerminal,
	requestToolApproval,
	submitAndExitInTerminal,
} from "../utils/approval";
import {
	type ChatCommandState,
	maybeHandleChatCommand,
} from "../utils/chat-commands";
import { createRuntimeHooks } from "../utils/hooks";
import { c, setActiveCliSession, writeErr, writeln } from "../utils/output";
import { createWorkspaceChatCommandHost } from "../utils/plugin-chat-commands";
import { readRepoStatus } from "../utils/repo-status";
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
import { loadInteractiveConfigData } from "./interactive-config";
import { InteractiveTui } from "./interactive-tui";
import {
	listInteractiveSlashCommands,
	resolveClineWelcomeLine,
} from "./interactive-welcome";
import { buildUserInputMessage } from "./prompt";
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
		clineProviderSettings?: Llms.ProviderSettings;
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

	const clineWelcomeLine = await resolveClineWelcomeLine({
		config,
		clineApiBaseUrl: options?.clineApiBaseUrl,
		clineProviderSettings: options?.clineProviderSettings,
	});
	const initialRepoStatus = await readRepoStatus(config.cwd);
	void prewarmFileIndex(config.cwd);
	const workflowSlashCommands = listInteractiveSlashCommands(
		userInstructionWatcher,
	);
	const { host: chatCommandHost, pluginSlashCommands } =
		await createWorkspaceChatCommandHost({
			cwd: config.cwd,
			workspaceRoot: config.workspaceRoot,
			logger: config.logger,
		});
	for (const cmd of pluginSlashCommands) {
		workflowSlashCommands.push({
			name: cmd.name,
			instructions: "",
			description: cmd.description ?? "Plugin command",
		});
	}

	const runtimeHooks = createRuntimeHooks({
		verbose: config.verbose,
		yolo: config.mode === "yolo",
	});
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
	const sessionManager = await createCliCore({
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

	const uiEvents = getUIEventEmitter();

	const onAgentEvent = (event: AgentEvent) => {
		uiEvents.emit("agent", event);
	};
	const unsubscribeAgent = subscribeToAgentEvents(sessionManager, onAgentEvent);
	const unsubscribePendingPrompts = subscribeToPendingPromptEvents(
		sessionManager,
		{
			onPendingPrompts: (event) => {
				uiEvents.emit("pending-prompts", event);
			},
			onPendingPromptSubmitted: (event) => {
				uiEvents.emit("pending-prompt-submitted", event);
			},
		},
	);

	const initialMessages = await loadInteractiveResumeMessages(
		sessionManager,
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
	// Tracks the session that is currently live for send/abort/stop operations.
	let activeSessionId = "";
	// One-time startup input: when present, the first interactive session
	// reuses this historical id instead of allocating a new one.
	const initialResumeSessionId = resumeSessionId?.trim() || undefined;
	const applyStartedSession = (
		started: Awaited<ReturnType<typeof sessionManager.start>>,
	) => {
		setActiveCliSession({
			manifestPath: started.manifestPath,
			transcriptPath: started.transcriptPath,
			hookPath: started.hookPath,
			messagesPath: started.messagesPath,
			manifest: started.manifest,
		});
		activeSessionId = started.sessionId;
	};
	/**
	 * Starts a brand-new interactive session. This path is used for normal boot
	 * when we are not resuming, and for later reset/new-session flows where we
	 * intentionally want a fresh session id.
	 */
	const startFreshSession = async (initial: typeof initialMessages = []) => {
		const started = await sessionManager.start({
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
				onTeamEvent: (event) => {
					uiEvents.emit("team", event);
				},
				onConsecutiveMistakeLimitReached: resolveMistakeLimitDecision,
			},
			interactive: true,
			initialMessages: initial,
			userInstructionWatcher,
			onTeamRestored: () => {},
		});
		applyStartedSession(started);
	};
	/**
	 * Starts the initial interactive session by continuing an existing historical
	 * session id. This is only used once during startup when `--resume` selected
	 * a session; later reset/new-session flows use `startFreshSession()` instead.
	 */
	const startResumedSession = async (
		resumeId: string,
		initial: typeof initialMessages,
	) => {
		const started = await sessionManager.start({
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
				onTeamEvent: (event) => {
					uiEvents.emit("team", event);
				},
				onConsecutiveMistakeLimitReached: resolveMistakeLimitDecision,
			},
			interactive: true,
			initialMessages: initial,
			userInstructionWatcher,
			onTeamRestored: () => {},
		});
		applyStartedSession(started);
	};
	if (initialResumeSessionId) {
		await startResumedSession(initialResumeSessionId, initialMessages);
	} else {
		await startFreshSession(initialMessages);
	}

	let isRunning = false;
	let abortRequested = false;
	const abortAll = () => {
		if (abortRequested) {
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
			requestExit();
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
			unsubscribeAgent();
			unsubscribePendingPrompts();
			try {
				await sessionManager.stop(activeSessionId);
			} finally {
				try {
					await sessionManager.dispose("cli_interactive_shutdown");
				} finally {
					await runtimeHooks.shutdown();
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
			welcomeLine: clineWelcomeLine ?? undefined,
			initialView: options?.initialView ?? "chat",
			initialRepoStatus,
			workflowSlashCommands,
			loadConfigData: async () =>
				loadInteractiveConfigData({
					watcher: userInstructionWatcher,
					cwd: config.cwd,
					workspaceRoot: config.workspaceRoot?.trim() || config.cwd,
				}),
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
				abortRequested = false;
				if (!delivery) {
					isRunning = true;
				}
				try {
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
							if (activeSessionId) {
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
							host: chatCommandHost,
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
								if (activeSessionId) {
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
					const userInput = await buildUserInputMessage(
						input,
						userInstructionWatcher,
					);
					const result = await sessionManager.send({
						sessionId: activeSessionId,
						prompt: userInput,
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
