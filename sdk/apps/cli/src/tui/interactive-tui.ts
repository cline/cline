import { basename } from "node:path";
import type { AgentEvent, TeamEvent } from "@clinebot/core";
import { Box, Text, useInput } from "ink";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	InteractiveConfigData,
	InteractiveConfigTab,
} from "../runtime/interactive-config";
import {
	type InteractiveSlashCommand,
	searchWorkspaceFilesForMention,
} from "../runtime/interactive-welcome";
import type {
	PendingPromptSnapshot,
	PendingPromptSubmittedEvent,
} from "../runtime/session-events";
import { resolveStatusNoticeLabel } from "../utils/events";
import { formatToolInput, formatToolOutput, truncate } from "../utils/helpers";
import { c, formatUsd } from "../utils/output";
import { type RepoStatus, readRepoStatus } from "../utils/repo-status";
import type { Config } from "../utils/types";
import { WelcomeView } from "./components/WelcomeView";

interface InteractiveTurnResult {
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalCost?: number;
	};
	iterations: number;
	commandOutput?: string;
	queued?: boolean;
}

interface QueuedPromptItem {
	id: string;
	prompt: string;
	steer: boolean;
}

interface InteractiveTuiProps {
	config: Config;
	welcomeLine?: string;
	initialView?: "chat" | "config";
	initialRepoStatus?: RepoStatus;
	workflowSlashCommands?: InteractiveSlashCommand[];
	loadConfigData: () => Promise<InteractiveConfigData>;
	subscribeToEvents: (handlers: {
		onAgentEvent: (event: AgentEvent) => void;
		onTeamEvent: (event: TeamEvent) => void;
		onPendingPrompts: (event: PendingPromptSnapshot) => void;
		onPendingPromptSubmitted: (event: PendingPromptSubmittedEvent) => void;
	}) => () => void;
	onSubmit: (
		input: string,
		mode: "act" | "plan",
		delivery?: "queue" | "steer",
	) => Promise<InteractiveTurnResult>;
	onAbort: () => void;
	onExit: () => void;
	onRunningChange: (isRunning: boolean) => void;
	onTurnErrorReported: (reported: boolean) => void;
	onAutoApproveChange: (enabled: boolean) => void;
}

interface UiLine {
	id: number;
	text: string;
}

type InlineStream = "text" | "reasoning" | undefined;
type CompletionMode = "mention" | "slash" | undefined;

interface MentionQueryInfo {
	inMentionMode: boolean;
	query: string;
	atIndex: number;
}

interface SlashQueryInfo {
	inSlashMode: boolean;
	query: string;
	slashIndex: number;
}

const MAX_LINES_FALLBACK = 40;
const MAX_BUFFERED_LINES = 500;
const DEFAULT_CONTEXT_WINDOW = 200000;
const COMPLETION_DEBOUNCE_MS = 120;
const MAX_COMPLETION_RESULTS = 8;
const MAX_MENU_ITEMS_VISIBLE = 5;
const MAX_CONFIG_ITEMS_VISIBLE = 12;
const TEAM_RUN_ACTIVE_SUFFIX = `${c.dim} ...${c.reset}`;
const CONFIG_TABS: InteractiveConfigTab[] = [
	"tools",
	"plugins",
	"agents",
	"hooks",
	"skills",
	"rules",
	"mcp",
];

function toTabLabel(tab: InteractiveConfigTab): string {
	switch (tab) {
		case "tools":
			return "Tools";
		case "skills":
			return "Skills";
		case "rules":
			return "Rules";
		case "hooks":
			return "Hooks";
		case "agents":
			return "Agents";
		case "plugins":
			return "Plugins";
		case "mcp":
			return "MCP";
	}
}

function isConfigCommand(text: string): boolean {
	const normalized = text.trim().toLowerCase();
	return normalized === "/config" || normalized === "/settings";
}

function isLikelyMouseEscapeSequence(input: string): boolean {
	if (input.length === 0) {
		return false;
	}
	if (input.includes("[<") && /\[<\d+;\d+;\d+[mM]/.test(input)) {
		return true;
	}
	// Sometimes chunks arrive split and lose the leading "[<".
	// Filter pure coordinate-like control payloads to keep input clean.
	if (/^[\d;[<mM]+$/.test(input) && input.includes(";") && /[mM]/.test(input)) {
		return true;
	}
	return false;
}

function createContextBar(
	used: number,
	total: number,
	width = 8,
): { filled: string; empty: string } {
	const ratio = total > 0 ? Math.min(used / total, 1) : 0;
	const filledCount = used > 0 ? Math.max(1, Math.round(ratio * width)) : 0;
	const emptyCount = Math.max(0, width - filledCount);
	return {
		filled: "█".repeat(filledCount),
		empty: "█".repeat(emptyCount),
	};
}

function extractMentionQuery(text: string): MentionQueryInfo {
	const atIndex = text.lastIndexOf("@");
	if (atIndex === -1 || (atIndex > 0 && !/\s/.test(text[atIndex - 1] ?? ""))) {
		return { inMentionMode: false, query: "", atIndex: -1 };
	}
	const query = text.slice(atIndex + 1);
	if (query.includes(" ")) {
		return { inMentionMode: false, query: "", atIndex: -1 };
	}
	return { inMentionMode: true, query, atIndex };
}

function insertMention(
	text: string,
	atIndex: number,
	filePath: string,
): string {
	const endIndex = text.indexOf(" ", atIndex);
	const end = endIndex === -1 ? text.length : endIndex;
	const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
	const mention = normalizedPath.includes(" ")
		? `@"${normalizedPath}"`
		: `@${normalizedPath}`;
	return `${text.slice(0, atIndex)}${mention} ${text.slice(end).trimStart()}`;
}

function extractSlashQuery(text: string): SlashQueryInfo {
	const slashIndex = text.lastIndexOf("/");
	if (slashIndex === -1) {
		return { inSlashMode: false, query: "", slashIndex: -1 };
	}
	if (slashIndex > 0 && !/\s/.test(text[slashIndex - 1] ?? "")) {
		return { inSlashMode: false, query: "", slashIndex: -1 };
	}
	const query = text.slice(slashIndex + 1);
	if (/\s/.test(query)) {
		return { inSlashMode: false, query: "", slashIndex: -1 };
	}
	const firstSlashCommandRegex = /(^|\s)\/[a-zA-Z0-9_.-]+\s/;
	const textBeforeCurrentSlash = text.slice(0, slashIndex);
	if (firstSlashCommandRegex.test(textBeforeCurrentSlash)) {
		return { inSlashMode: false, query: "", slashIndex: -1 };
	}
	return { inSlashMode: true, query, slashIndex };
}

function insertSlashCommand(
	text: string,
	slashIndex: number,
	commandName: string,
): string {
	return `${text.slice(0, slashIndex)}/${commandName} `;
}

function truncatePath(path: string, maxLength = 70): string {
	if (path.length <= maxLength) {
		return path;
	}
	return `...${path.slice(-(maxLength - 3))}`;
}

function getVisibleWindow<T>(
	items: T[],
	selectedIndex: number,
	maxVisible = MAX_MENU_ITEMS_VISIBLE,
): { items: T[]; startIndex: number } {
	if (items.length <= maxVisible) {
		return { items, startIndex: 0 };
	}
	const halfWindow = Math.floor(maxVisible / 2);
	let startIndex = Math.max(0, selectedIndex - halfWindow);
	const endIndex = Math.min(items.length, startIndex + maxVisible);
	if (endIndex - startIndex < maxVisible) {
		startIndex = Math.max(0, endIndex - maxVisible);
	}
	return { items: items.slice(startIndex, endIndex), startIndex };
}

function resolveModelContextWindow(config: Config): number {
	const modelInfo = (config.knownModels?.[config.modelId] ?? {}) as {
		contextWindow?: number;
		context_window?: number;
	};
	if (
		typeof modelInfo.contextWindow === "number" &&
		modelInfo.contextWindow > 0
	) {
		return modelInfo.contextWindow;
	}
	if (
		typeof modelInfo.context_window === "number" &&
		modelInfo.context_window > 0
	) {
		return modelInfo.context_window;
	}
	return DEFAULT_CONTEXT_WINDOW;
}

export function InteractiveTui(props: InteractiveTuiProps): React.ReactElement {
	const {
		config,
		subscribeToEvents,
		onSubmit,
		onAbort,
		onExit,
		onRunningChange,
		onTurnErrorReported,
		onAutoApproveChange,
	} = props;

	// Output
	const [lines, setLines] = useState<UiLine[]>(
		props.welcomeLine ? [{ id: 0, text: props.welcomeLine }] : [],
	);

	// Input & submission
	const [input, setInput] = useState("");
	const [isRunning, setIsRunning] = useState(false);
	const [isExitRequested, setIsExitRequested] = useState(false);
	const [abortRequested, setAbortRequested] = useState(false);
	const [hasSubmitted, setHasSubmitted] = useState(false);
	const [uiMode, setUiMode] = useState<"act" | "plan">(config.mode);
	const [autoApproveAll, setAutoApproveAll] = useState(
		config.toolPolicies["*"]?.autoApprove !== false,
	);
	const [queuedPrompts, setQueuedPrompts] = useState<QueuedPromptItem[]>([]);

	// File mention completion
	const [fileMentionResults, setFileMentionResults] = useState<string[]>([]);
	const [fileMentionSelectedIndex, setFileMentionSelectedIndex] = useState(0);
	const [isSearchingMentions, setIsSearchingMentions] = useState(false);

	// Slash command completion
	const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

	const mouseOffsetX = 0;
	const mouseOffsetY = 0;

	// Usage statistics
	const [lastTotalTokens, setLastTotalTokens] = useState(0);
	const [lastTotalCost, setLastTotalCost] = useState(0);

	// Git status
	const [repoStatus, setRepoStatus] = useState<RepoStatus>(
		props.initialRepoStatus ?? {
			branch: null,
			diffStats: null,
		},
	);

	// Config view
	const [isConfigViewOpen, setIsConfigViewOpen] = useState(
		props.initialView === "config",
	);
	const [isLoadingConfig, setIsLoadingConfig] = useState(false);
	const [configData, setConfigData] = useState<InteractiveConfigData>({
		workflows: [],
		rules: [],
		skills: [],
		hooks: [],
		agents: [],
		plugins: [],
		mcp: [],
		tools: [],
	});
	const [configTab, setConfigTab] = useState<InteractiveConfigTab>("tools");
	const [configSelectedIndex, setConfigSelectedIndex] = useState(0);

	const nextLineIdRef = useRef(props.welcomeLine ? 1 : 0);
	const activeInlineStreamRef = useRef<InlineStream>(undefined);
	const mentionSearchTimerRef = useRef<NodeJS.Timeout | null>(null);
	const mentionSearchCounterRef = useRef(0);
	const turnErrorReportedRef = useRef(false);
	const configLoadCounterRef = useRef(0);
	const knownPendingPromptIdsRef = useRef(new Set<string>());
	const eventHandlersRef = useRef<{
		onAgentEvent: (event: AgentEvent) => void;
		onTeamEvent: (event: TeamEvent) => void;
		onPendingPrompts: (event: PendingPromptSnapshot) => void;
		onPendingPromptSubmitted: (event: PendingPromptSubmittedEvent) => void;
	} | null>(null);

	const workspaceName = useMemo(
		() => basename(config.cwd) || config.cwd,
		[config.cwd],
	);
	const workspaceRoot = useMemo(
		() => config.workspaceRoot?.trim() || config.cwd,
		[config.cwd, config.workspaceRoot],
	);
	const contextWindowSize = useMemo(
		() => resolveModelContextWindow(config),
		[config],
	);
	const maxVisibleLines = Math.max(
		12,
		(process.stdout.rows ?? MAX_LINES_FALLBACK) - 14,
	);
	const mentionInfo = useMemo(() => extractMentionQuery(input), [input]);
	const slashInfo = useMemo(() => extractSlashQuery(input), [input]);
	const slashCommands = useMemo(
		() => props.workflowSlashCommands ?? [],
		[props.workflowSlashCommands],
	);
	const filteredSlashCommands = useMemo(() => {
		if (!slashInfo.inSlashMode) {
			return [];
		}
		const query = slashInfo.query.trim().toLowerCase();
		if (!query) {
			return slashCommands.slice(0, MAX_COMPLETION_RESULTS);
		}
		return slashCommands
			.filter((command) => command.name.toLowerCase().includes(query))
			.sort((a, b) => {
				const aName = a.name.toLowerCase();
				const bName = b.name.toLowerCase();
				const aStarts = aName.startsWith(query);
				const bStarts = bName.startsWith(query);
				if (aStarts !== bStarts) {
					return aStarts ? -1 : 1;
				}
				return aName.localeCompare(bName);
			})
			.slice(0, MAX_COMPLETION_RESULTS);
	}, [slashCommands, slashInfo.inSlashMode, slashInfo.query]);

	const activeCompletionMode: CompletionMode = mentionInfo.inMentionMode
		? "mention"
		: slashInfo.inSlashMode
			? "slash"
			: undefined;

	const activeConfigItems = useMemo(() => {
		switch (configTab) {
			case "skills":
				return [...configData.workflows, ...configData.skills].sort((a, b) => {
					if (a.source !== b.source) {
						return a.source === "workspace" ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				});
			case "rules":
				return configData.rules;
			case "hooks":
				return configData.hooks;
			case "agents":
				return configData.agents;
			case "plugins":
				return configData.plugins;
			case "mcp":
				return configData.mcp;
			case "tools":
				return configData.tools;
		}
	}, [configData, configTab]);

	const refreshRepoStatus = useCallback(() => {
		void readRepoStatus(config.cwd).then((nextStatus) => {
			setRepoStatus((currentStatus) => {
				const sameBranch = currentStatus.branch === nextStatus.branch;
				const sameDiffStats =
					currentStatus.diffStats?.files === nextStatus.diffStats?.files &&
					currentStatus.diffStats?.additions ===
						nextStatus.diffStats?.additions &&
					currentStatus.diffStats?.deletions ===
						nextStatus.diffStats?.deletions;
				return sameBranch && sameDiffStats ? currentStatus : nextStatus;
			});
		});
	}, [config.cwd]);

	const closeConfigView = useCallback(() => {
		setIsConfigViewOpen(false);
		setConfigSelectedIndex(0);
	}, []);

	const loadConfig = useCallback(() => {
		const loadId = ++configLoadCounterRef.current;
		setIsLoadingConfig(true);
		void props
			.loadConfigData()
			.then((nextData) => {
				if (loadId !== configLoadCounterRef.current) {
					return;
				}
				setConfigData(nextData);
			})
			.catch(() => {
				if (loadId !== configLoadCounterRef.current) {
					return;
				}
				setConfigData({
					workflows: [],
					rules: [],
					skills: [],
					hooks: [],
					agents: [],
					plugins: [],
					mcp: [],
					tools: [],
				});
			})
			.finally(() => {
				if (loadId !== configLoadCounterRef.current) {
					return;
				}
				setIsLoadingConfig(false);
			});
	}, [props.loadConfigData]);

	const openConfigView = useCallback(() => {
		setIsConfigViewOpen(true);
		setConfigTab("skills");
		setConfigSelectedIndex(0);
		loadConfig();
	}, [loadConfig]);

	useEffect(() => {
		onAutoApproveChange(autoApproveAll);
	}, [autoApproveAll, onAutoApproveChange]);

	useEffect(() => {
		if (props.initialView === "config") {
			loadConfig();
		}
	}, [loadConfig, props.initialView]);

	useEffect(() => {
		refreshRepoStatus();
	}, [refreshRepoStatus]);

	useEffect(() => {
		if (!mentionInfo.inMentionMode) {
			setIsSearchingMentions((current) => (current ? false : current));
			setFileMentionResults((current) => (current.length > 0 ? [] : current));
			if (mentionSearchTimerRef.current) {
				clearTimeout(mentionSearchTimerRef.current);
				mentionSearchTimerRef.current = null;
			}
			return;
		}
		if (mentionSearchTimerRef.current) {
			clearTimeout(mentionSearchTimerRef.current);
			mentionSearchTimerRef.current = null;
		}
		const currentSearchId = ++mentionSearchCounterRef.current;
		setIsSearchingMentions(true);
		mentionSearchTimerRef.current = setTimeout(() => {
			void searchWorkspaceFilesForMention({
				workspaceRoot,
				query: mentionInfo.query,
				limit: MAX_COMPLETION_RESULTS,
			})
				.then((results) => {
					if (currentSearchId !== mentionSearchCounterRef.current) {
						return;
					}
					setFileMentionResults(results);
				})
				.catch(() => {
					if (currentSearchId !== mentionSearchCounterRef.current) {
						return;
					}
					setFileMentionResults([]);
				})
				.finally(() => {
					if (currentSearchId !== mentionSearchCounterRef.current) {
						return;
					}
					setIsSearchingMentions(false);
				});
		}, COMPLETION_DEBOUNCE_MS);
		return () => {
			if (mentionSearchTimerRef.current) {
				clearTimeout(mentionSearchTimerRef.current);
				mentionSearchTimerRef.current = null;
			}
		};
	}, [mentionInfo.inMentionMode, mentionInfo.query, workspaceRoot]);

	const appendLine = useCallback((text: string) => {
		setLines((prev) => {
			const next = [...prev, { id: nextLineIdRef.current++, text }];
			if (next.length <= MAX_BUFFERED_LINES) {
				return next;
			}
			return next.slice(next.length - MAX_BUFFERED_LINES);
		});
	}, []);

	const appendInline = useCallback((text: string) => {
		setLines((prev) => {
			if (prev.length === 0) {
				return [{ id: nextLineIdRef.current++, text }];
			}
			const next = [...prev];
			const lastIndex = next.length - 1;
			next[lastIndex] = {
				...next[lastIndex],
				text: `${next[lastIndex]?.text ?? ""}${text}`,
			};
			return next;
		});
	}, []);

	const closeInlineStream = useCallback(() => {
		activeInlineStreamRef.current = undefined;
	}, []);

	const handleAgentEvent = useCallback(
		(event: AgentEvent) => {
			switch (event.type) {
				case "iteration_start":
					setIsRunning(true);
					closeInlineStream();
					break;
				case "iteration_end":
					closeInlineStream();
					break;
				case "content_start": {
					switch (event.contentType) {
						case "text": {
							if (activeInlineStreamRef.current !== "text") {
								closeInlineStream();
								appendLine("");
								activeInlineStreamRef.current = "text";
							}
							appendInline(event.text ?? "");
							break;
						}
						case "reasoning": {
							if (activeInlineStreamRef.current !== "reasoning") {
								closeInlineStream();
								appendLine(`${c.dim}[thinking] ${c.reset}`);
								activeInlineStreamRef.current = "reasoning";
							}
							if (event.redacted && !event.reasoning) {
								appendInline(`${c.dim}[redacted]${c.reset}`);
								break;
							}
							appendInline(`${c.dim}${event.reasoning ?? ""}${c.reset}`);
							break;
						}
						case "tool": {
							closeInlineStream();
							const toolName = event.toolName ?? "unknown_tool";
							const inputStr = formatToolInput(toolName, event.input);
							appendLine(
								`${c.dim}[${toolName}]${c.reset} ${c.cyan}${inputStr}${c.reset}`,
							);
							break;
						}
					}
					break;
				}
				case "content_end": {
					switch (event.contentType) {
						case "text":
						case "reasoning":
							closeInlineStream();
							break;
						case "tool": {
							closeInlineStream();
							if (event.error) {
								appendLine(`${c.red}error:${c.reset} ${event.error}`);
							} else {
								const outputStr = formatToolOutput(event.output);
								appendLine(
									outputStr
										? `  ${c.dim}-> ${outputStr}${c.reset}`
										: ` ${c.green}ok${c.reset}`,
								);
							}
							break;
						}
					}
					break;
				}
				case "done":
					setIsRunning(false);
					closeInlineStream();
					break;
				case "error":
					setIsRunning(false);
					closeInlineStream();
					turnErrorReportedRef.current = true;
					onTurnErrorReported(true);
					appendLine(`${c.red}error:${c.reset} ${event.error.message}`);
					break;
				case "notice":
					if (event.displayRole === "status") {
						closeInlineStream();
						const label = resolveStatusNoticeLabel(event);
						if (label) {
							appendLine(`${c.dim}[status]${c.reset} ${label}`);
						}
					}
					break;
			}
		},
		[appendInline, appendLine, closeInlineStream, onTurnErrorReported],
	);

	const handleTeamEvent = useCallback(
		(event: TeamEvent) => {
			switch (event.type) {
				case "teammate_spawned":
					appendLine(
						`${c.dim}[team] teammate spawned:${c.reset} ${c.cyan}${event.agentId}${c.reset}`,
					);
					break;
				case "teammate_shutdown":
					appendLine(
						`${c.dim}[team] teammate shutdown:${c.reset} ${c.cyan}${event.agentId}${c.reset}`,
					);
					break;
				case "team_task_updated":
					appendLine(
						`${c.dim}[team task]${c.reset} ${c.cyan}${event.task.id}${c.reset} -> ${event.task.status}`,
					);
					break;
				case "team_message":
					appendLine(
						`${c.dim}[mailbox]${c.reset} ${event.message.fromAgentId} -> ${event.message.toAgentId}: ${event.message.subject}`,
					);
					break;
				case "team_mission_log":
					appendLine(
						`${c.dim}[mission]${c.reset} ${event.entry.agentId}: ${truncate(event.entry.summary, 90)}`,
					);
					break;
				case "run_queued":
					appendLine(
						`${c.dim}[team run]${c.reset} queued ${c.cyan}${event.run.id}${c.reset} -> ${event.run.agentId}${TEAM_RUN_ACTIVE_SUFFIX}`,
					);
					break;
				case "run_started":
					appendLine(
						`${c.dim}[team run]${c.reset} started ${c.cyan}${event.run.id}${c.reset} -> ${event.run.agentId}${TEAM_RUN_ACTIVE_SUFFIX}`,
					);
					break;
				case "run_progress":
					if (event.message === "heartbeat") {
						break;
					}
					appendLine(
						`${c.dim}[team run]${c.reset} progress ${c.cyan}${event.run.id}${c.reset}: ${event.message}`,
					);
					break;
				case "run_completed":
					appendLine(
						`${c.dim}[team run]${c.reset} completed ${c.cyan}${event.run.id}${c.reset}`,
					);
					break;
				case "run_failed":
					appendLine(
						`${c.dim}[team run]${c.reset} failed ${c.cyan}${event.run.id}${c.reset}: ${event.run.error ?? "unknown error"}`,
					);
					break;
				case "run_cancelled":
					appendLine(
						`${c.dim}[team run]${c.reset} cancelled ${c.cyan}${event.run.id}${c.reset}`,
					);
					break;
				case "run_interrupted":
					appendLine(
						`${c.dim}[team run]${c.reset} interrupted ${c.cyan}${event.run.id}${c.reset}`,
					);
					break;
				case "outcome_created":
					appendLine(
						`${c.dim}[team outcome]${c.reset} created ${c.cyan}${event.outcome.id}${c.reset}: ${event.outcome.title}`,
					);
					break;
				case "outcome_fragment_attached":
					appendLine(
						`${c.dim}[team outcome]${c.reset} fragment ${c.cyan}${event.fragment.id}${c.reset} attached to ${event.fragment.section}`,
					);
					break;
				case "outcome_fragment_reviewed":
					appendLine(
						`${c.dim}[team outcome]${c.reset} fragment ${c.cyan}${event.fragment.id}${c.reset} -> ${event.fragment.status}`,
					);
					break;
				case "outcome_finalized":
					appendLine(
						`${c.dim}[team outcome]${c.reset} finalized ${c.cyan}${event.outcome.id}${c.reset}`,
					);
					break;
				case "task_start":
				case "task_end":
				case "agent_event":
					break;
			}
		},
		[appendLine],
	);

	const handlePendingPrompts = useCallback((event: PendingPromptSnapshot) => {
		const nextIds = new Set<string>();
		for (const entry of event.prompts) {
			nextIds.add(entry.id);
		}
		knownPendingPromptIdsRef.current = nextIds;
		setQueuedPrompts(
			event.prompts.map((entry, index) => ({
				id: entry.id || `${entry.delivery}:${index}:${entry.prompt}`,
				prompt: entry.prompt,
				steer: entry.delivery === "steer",
			})),
		);
	}, []);

	const handlePendingPromptSubmitted = useCallback(
		(event: PendingPromptSubmittedEvent) => {
			knownPendingPromptIdsRef.current.delete(event.id);
			appendLine(`${c.green}>${c.reset} ${event.prompt}`);
		},
		[appendLine],
	);

	// Keep the ref in sync with the latest handler instances so the
	// stable wrappers registered below always delegate to current callbacks.
	eventHandlersRef.current = {
		onAgentEvent: handleAgentEvent,
		onTeamEvent: handleTeamEvent,
		onPendingPrompts: handlePendingPrompts,
		onPendingPromptSubmitted: handlePendingPromptSubmitted,
	};

	// Subscribe exactly once. The stable wrapper functions forward to
	// eventHandlersRef.current so handler identity changes (from useCallback
	// dep changes) never cause re-subscription on the EventEmitter.
	// biome-ignore lint/correctness/useExhaustiveDependencies: subscribeToEvents is an inline prop; ref-based delegation makes re-subscription unnecessary
	useEffect(
		() =>
			subscribeToEvents({
				onAgentEvent: (event) => eventHandlersRef.current?.onAgentEvent(event),
				onTeamEvent: (event) => eventHandlersRef.current?.onTeamEvent(event),
				onPendingPrompts: (event) =>
					eventHandlersRef.current?.onPendingPrompts(event),
				onPendingPromptSubmitted: (event) =>
					eventHandlersRef.current?.onPendingPromptSubmitted(event),
			}),
		[],
	);

	useEffect(() => {
		onRunningChange(isRunning);
	}, [isRunning, onRunningChange]);

	useEffect(() => {
		if (!isExitRequested) {
			return;
		}
		const timer = setTimeout(() => {
			onExit();
		}, 0);
		return () => clearTimeout(timer);
	}, [isExitRequested, onExit]);

	const requestExit = useCallback(() => {
		setInput("");
		setIsExitRequested(true);
	}, []);

	const submitPrompt = useCallback(
		async (prompt: string, delivery?: "queue" | "steer") => {
			setHasSubmitted(true);
			if (!delivery) {
				setIsRunning(true);
				setAbortRequested(false);
				turnErrorReportedRef.current = false;
				onTurnErrorReported(false);
			}
			const prefix =
				delivery === "steer"
					? `${c.yellow}[steer]${c.reset} `
					: delivery === "queue"
						? `${c.dim}[queued]${c.reset} `
						: "";
			appendLine(`${c.green}>${c.reset} ${prefix}${prompt}`);
			setInput("");

			const startedAt = performance.now();
			try {
				const result = await onSubmit(prompt, uiMode, delivery);
				if (result.commandOutput) {
					appendLine(result.commandOutput);
				}
				if (result.queued) {
					return;
				}
				const tokens = result.usage.inputTokens + result.usage.outputTokens;
				setLastTotalTokens(tokens);
				if (typeof result.usage.totalCost === "number") {
					setLastTotalCost(result.usage.totalCost);
				}
				if (!result.commandOutput && (config.showTimings || config.showUsage)) {
					const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
					const parts: string[] = [];
					if (config.showTimings) {
						parts.push(`${elapsed}s`);
					}
					if (config.showUsage) {
						parts.push(`${tokens} tokens`);
						if (typeof result.usage.totalCost === "number") {
							parts.push(`${formatUsd(result.usage.totalCost)} est. cost`);
						}
						if (result.iterations > 1) {
							parts.push(`${result.iterations} iterations`);
						}
					}
					appendLine(`${c.dim}[${parts.join(" | ")}]${c.reset}`);
				}
			} catch (error) {
				if (!turnErrorReportedRef.current) {
					appendLine(
						`${c.red}error:${c.reset} ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			} finally {
				if (!delivery) {
					setIsRunning(false);
					refreshRepoStatus();
				}
			}
		},
		[
			appendLine,
			config.showTimings,
			config.showUsage,
			onSubmit,
			onTurnErrorReported,
			refreshRepoStatus,
			uiMode,
		],
	);

	useInput((value, key) => {
		if (isExitRequested) {
			return;
		}

		if (isLikelyMouseEscapeSequence(value)) {
			return;
		}

		if (isConfigViewOpen) {
			const isShiftTab = (key.shift && key.tab) || value === "\u001b[Z";
			const isTab = key.tab || value === "\t";
			if (key.escape || (key.ctrl && value === "d")) {
				closeConfigView();
				return;
			}
			if (key.ctrl && value === "c") {
				closeConfigView();
				return;
			}
			if (isTab || isShiftTab) {
				setConfigTab((prev) => {
					const currentIndex = CONFIG_TABS.indexOf(prev);
					if (currentIndex < 0) {
						return CONFIG_TABS[0] ?? "tools";
					}
					const delta = isShiftTab ? -1 : 1;
					const nextIndex =
						(currentIndex + delta + CONFIG_TABS.length) % CONFIG_TABS.length;
					return CONFIG_TABS[nextIndex] ?? prev;
				});
				setConfigSelectedIndex(0);
				return;
			}
			if (key.leftArrow || key.rightArrow) {
				return;
			}
			if (key.upArrow) {
				if (activeConfigItems.length > 0) {
					setConfigSelectedIndex((prev) =>
						prev > 0 ? prev - 1 : activeConfigItems.length - 1,
					);
				}
				return;
			}
			if (key.downArrow) {
				if (activeConfigItems.length > 0) {
					setConfigSelectedIndex((prev) =>
						prev < activeConfigItems.length - 1 ? prev + 1 : 0,
					);
				}
				return;
			}
			if (key.return) {
				const selected = activeConfigItems[configSelectedIndex];
				if (selected && configTab === "skills") {
					setInput(`/${selected.name} `);
					closeConfigView();
				}
				return;
			}
			return;
		}

		const mentionResults = fileMentionResults;
		const slashResults = filteredSlashCommands;
		const hasMentionMenu =
			activeCompletionMode === "mention" && mentionResults.length > 0;
		const hasSlashMenu =
			activeCompletionMode === "slash" && slashResults.length > 0;
		const hasCompletionMenu = hasMentionMenu || hasSlashMenu;

		const isShiftTab = (key.shift && key.tab) || value === "\u001b[Z";
		if (isShiftTab) {
			setAutoApproveAll((prev) => !prev);
			return;
		}

		const isTab = key.tab || value === "\t";
		if (isTab) {
			if (hasMentionMenu) {
				const selectedPath = mentionResults[fileMentionSelectedIndex];
				if (selectedPath) {
					setInput((prev) =>
						insertMention(
							prev,
							extractMentionQuery(prev).atIndex,
							selectedPath,
						),
					);
				}
				return;
			}
			if (hasSlashMenu) {
				const selectedCommand = slashResults[slashSelectedIndex];
				if (selectedCommand) {
					setInput((prev) =>
						insertSlashCommand(
							prev,
							extractSlashQuery(prev).slashIndex,
							selectedCommand.name,
						),
					);
				}
				return;
			}
			if (activeCompletionMode) {
				return;
			}
			setUiMode((prev) => (prev === "act" ? "plan" : "act"));
			return;
		}

		if (key.ctrl && value === "c") {
			if (isRunning) {
				if (!abortRequested) {
					setAbortRequested(true);
					onAbort();
					appendLine(`${c.dim}[abort] requested${c.reset}`);
				}
				return;
			}
			requestExit();
			return;
		}

		if (key.ctrl && value === "d") {
			if (!isRunning && input.length === 0) {
				requestExit();
				return;
			}
		}

		if (key.ctrl && value === "s") {
			if (!isRunning) {
				return;
			}
			const trimmed = input.trim();
			if (trimmed) {
				void submitPrompt(trimmed, "steer");
				return;
			}
			// If the input is empty, promote the first queued (non-steer) item to
			// steer delivery so that the hint "Ctrl+S steers the next turn" works
			// even after the user has already pressed Enter to queue a message.
			const firstQueued = queuedPrompts.find((item) => !item.steer);
			if (firstQueued) {
				void submitPrompt(firstQueued.prompt, "steer");
			}
			return;
		}

		if (key.return) {
			if (hasMentionMenu) {
				const selectedPath = mentionResults[fileMentionSelectedIndex];
				if (selectedPath) {
					setInput((prev) =>
						insertMention(
							prev,
							extractMentionQuery(prev).atIndex,
							selectedPath,
						),
					);
				}
				return;
			}
			if (hasSlashMenu) {
				const selectedCommand = slashResults[slashSelectedIndex];
				if (selectedCommand) {
					setInput((prev) =>
						insertSlashCommand(
							prev,
							extractSlashQuery(prev).slashIndex,
							selectedCommand.name,
						),
					);
				}
				return;
			}
			if (activeCompletionMode) {
				return;
			}
			const trimmed = input.trim();
			if (!trimmed) {
				return;
			}
			if (!isRunning && isConfigCommand(trimmed)) {
				setInput("");
				openConfigView();
				return;
			}
			void submitPrompt(trimmed, isRunning ? "queue" : undefined);
			return;
		}

		if (key.backspace || key.delete) {
			setInput((prev) => prev.slice(0, -1));
			return;
		}

		if (key.upArrow) {
			if (hasMentionMenu) {
				setFileMentionSelectedIndex((prev) =>
					prev > 0 ? prev - 1 : mentionResults.length - 1,
				);
				return;
			}
			if (hasSlashMenu) {
				setSlashSelectedIndex((prev) =>
					prev > 0 ? prev - 1 : slashResults.length - 1,
				);
				return;
			}
			return;
		}

		if (key.downArrow) {
			if (hasMentionMenu) {
				setFileMentionSelectedIndex((prev) =>
					prev < mentionResults.length - 1 ? prev + 1 : 0,
				);
				return;
			}
			if (hasSlashMenu) {
				setSlashSelectedIndex((prev) =>
					prev < slashResults.length - 1 ? prev + 1 : 0,
				);
				return;
			}
			return;
		}

		if (key.escape) {
			if (hasCompletionMenu) {
				return;
			}
			return;
		}

		if (key.leftArrow || key.rightArrow) {
			return;
		}

		if (
			!key.ctrl &&
			!key.meta &&
			value.length > 0 &&
			!value.includes("\u001b")
		) {
			setInput((prev) => prev + value);
		}
	});

	const visibleLines = useMemo(
		() => lines.slice(-maxVisibleLines),
		[lines, maxVisibleLines],
	);
	const shouldShowWelcome =
		!isConfigViewOpen && !hasSubmitted && visibleLines.length <= 1;
	const visibleMentionResults = useMemo(
		() => getVisibleWindow(fileMentionResults, fileMentionSelectedIndex),
		[fileMentionResults, fileMentionSelectedIndex],
	);
	const visibleSlashResults = useMemo(
		() => getVisibleWindow(filteredSlashCommands, slashSelectedIndex),
		[filteredSlashCommands, slashSelectedIndex],
	);
	const visibleConfigItems = useMemo(
		() =>
			getVisibleWindow(
				activeConfigItems,
				Math.min(
					configSelectedIndex,
					Math.max(activeConfigItems.length - 1, 0),
				),
				MAX_CONFIG_ITEMS_VISIBLE,
			),
		[activeConfigItems, configSelectedIndex],
	);
	const contextBar = useMemo(
		() => createContextBar(lastTotalTokens, contextWindowSize),
		[lastTotalTokens, contextWindowSize],
	);
	const gitBranch = repoStatus.branch;
	const gitDiffStats = repoStatus.diffStats;

	// Render sections
	const renderWelcome = shouldShowWelcome
		? React.createElement(WelcomeView, {
				providerId: config.providerId,
				modelId: config.modelId,
				mode: uiMode,
				mouseOffsetX,
				mouseOffsetY,
			})
		: null;

	const renderLines = !isConfigViewOpen
		? React.createElement(
				Box,
				{ flexDirection: "column", marginBottom: 1 },
				visibleLines.map((line) =>
					React.createElement(Text, { key: line.id }, line.text),
				),
			)
		: null;

	const renderInputBox =
		!isConfigViewOpen && !isExitRequested
			? React.createElement(
					Box,
					{ flexDirection: "column" },
					queuedPrompts.length > 0
						? React.createElement(
								Box,
								{
									borderStyle: "round",
									paddingX: 1,
									paddingY: 0,
									marginBottom: 1,
									flexDirection: "column",
								},
								React.createElement(
									Text,
									{ color: "gray" },
									"Queued for upcoming turns",
								),
								React.createElement(
									Text,
									{ color: "gray" },
									"Enter queues while running. Ctrl+S steers the next turn.",
								),
								...queuedPrompts.map((item, index) =>
									React.createElement(
										Text,
										{
											key: item.id,
											color: item.steer ? "yellow" : undefined,
										},
										item.steer
											? `Steer: ${truncate(item.prompt, 100)}`
											: `Queue ${index + 1}: ${truncate(item.prompt, 100)}`,
									),
								),
							)
						: null,
					React.createElement(
						Box,
						{ borderStyle: "round", paddingX: 1 },
						React.createElement(Text, null, `${c.green}>${c.reset} ${input}`),
					),
				)
			: null;

	const renderConfigItems = isLoadingConfig
		? React.createElement(Text, { color: "gray" }, "Loading config...")
		: activeConfigItems.length === 0
			? React.createElement(
					Text,
					{ color: "gray" },
					`No ${toTabLabel(configTab).toLowerCase()} found.`,
				)
			: visibleConfigItems.items.map((item, index) => {
					const absoluteIndex = visibleConfigItems.startIndex + index;
					const selected = absoluteIndex === configSelectedIndex;
					const prefix = selected ? "❯" : " ";
					const enabledTag =
						typeof item.enabled === "boolean"
							? item.enabled
								? "enabled"
								: "disabled"
							: "";
					const details = [item.source, enabledTag, truncatePath(item.path, 42)]
						.filter((value) => value.length > 0)
						.join(" · ");
					return React.createElement(
						Box,
						{
							flexDirection: "column",
							key: `${item.id}:${absoluteIndex}`,
						},
						React.createElement(
							Text,
							{ color: selected ? "blue" : undefined },
							`${prefix} ${item.name}`,
						),
						React.createElement(Text, { color: "gray" }, `  ${details}`),
					);
				});

	const renderConfigView = isConfigViewOpen
		? React.createElement(
				Box,
				{
					flexDirection: "column",
					borderStyle: "round",
					paddingX: 1,
					marginBottom: 1,
				},
				React.createElement(Text, { color: "cyan" }, "Configuration"),
				React.createElement(
					Box,
					{ marginBottom: 1, gap: 1 },
					CONFIG_TABS.map((tab) =>
						React.createElement(
							Text,
							{
								key: tab,
								color: tab === configTab ? "blue" : "gray",
								bold: tab === configTab,
							},
							tab === configTab ? `[${toTabLabel(tab)}]` : toTabLabel(tab),
						),
					),
				),
				renderConfigItems,
				activeConfigItems.length >
					visibleConfigItems.startIndex + visibleConfigItems.items.length
					? React.createElement(Text, { color: "gray" }, "  ▼")
					: null,
			)
		: null;

	const renderMentionMenu =
		!isExitRequested && !isConfigViewOpen && mentionInfo.inMentionMode
			? React.createElement(
					Box,
					{ flexDirection: "column", marginTop: 1, paddingX: 1 },
					isSearchingMentions
						? React.createElement(Text, { color: "gray" }, "Searching files...")
						: fileMentionResults.length === 0
							? React.createElement(
									Text,
									{ color: "gray" },
									mentionInfo.query
										? `No files matching "${mentionInfo.query}"`
										: "Type to search files...",
								)
							: visibleMentionResults.items.map((path, index) => {
									const absoluteIndex =
										visibleMentionResults.startIndex + index;
									const selected = absoluteIndex === fileMentionSelectedIndex;
									const prefix = selected ? "❯" : " ";
									return React.createElement(
										Text,
										{
											color: selected ? "blue" : undefined,
											key: `${path}:${absoluteIndex}`,
										},
										`${prefix} ${truncatePath(path)}`,
									);
								}),
					fileMentionResults.length >
						visibleMentionResults.startIndex +
							visibleMentionResults.items.length
						? React.createElement(Text, { color: "gray" }, "  ▼")
						: null,
				)
			: null;

	const renderSlashMenu =
		!isExitRequested &&
		!isConfigViewOpen &&
		!mentionInfo.inMentionMode &&
		slashInfo.inSlashMode
			? React.createElement(
					Box,
					{ flexDirection: "column", marginTop: 1, paddingX: 1 },
					filteredSlashCommands.length === 0
						? React.createElement(
								Text,
								{ color: "gray" },
								slashInfo.query
									? `No commands matching "/${slashInfo.query}"`
									: "No slash commands available",
							)
						: visibleSlashResults.items.map((command, index) => {
								const absoluteIndex = visibleSlashResults.startIndex + index;
								const selected = absoluteIndex === slashSelectedIndex;
								const prefix = selected ? "❯" : " ";
								const summary = command.description
									? `${prefix} /${command.name} - ${command.description}`
									: `${prefix} /${command.name}`;
								return React.createElement(
									Text,
									{
										color: selected ? "blue" : undefined,
										key: `${command.name}:${absoluteIndex}`,
									},
									summary,
								);
							}),
					filteredSlashCommands.length >
						visibleSlashResults.startIndex + visibleSlashResults.items.length
						? React.createElement(Text, { color: "gray" }, "  ▼")
						: null,
				)
			: null;

	const renderModeSelector = React.createElement(
		Box,
		{ gap: 1 },
		React.createElement(
			Text,
			{
				color: uiMode === "plan" ? "yellow" : "gray",
				bold: uiMode === "plan",
			},
			`${uiMode === "plan" ? "●" : "○"} Plan`,
		),
		React.createElement(
			Text,
			{
				color: uiMode === "act" ? "blue" : "gray",
				bold: uiMode === "act",
			},
			`${uiMode === "act" ? "●" : "○"} Act`,
		),
		React.createElement(Text, { color: "gray" }, "(Tab)"),
	);

	const renderGitDiffStats =
		gitDiffStats && gitDiffStats.files > 0
			? React.createElement(
					Text,
					{ color: "gray" },
					` | ${gitDiffStats.files} file${gitDiffStats.files !== 1 ? "s" : ""} `,
					React.createElement(
						Text,
						{ color: "green" },
						`+${gitDiffStats.additions}`,
					),
					" ",
					React.createElement(
						Text,
						{ color: "red" },
						`-${gitDiffStats.deletions}`,
					),
				)
			: null;

	const renderAutoApprove = autoApproveAll
		? React.createElement(
				Text,
				null,
				React.createElement(
					Text,
					{ color: "green" },
					"⏵⏵ Auto-approve all enabled",
				),
				React.createElement(Text, { color: "gray" }, " (Shift+Tab)"),
			)
		: React.createElement(
				Text,
				{ color: "gray" },
				"Auto-approve all disabled (Shift+Tab)",
			);

	const renderQueueHint =
		!isConfigViewOpen && !isExitRequested
			? React.createElement(
					Text,
					{ color: "gray" },
					isRunning
						? "Enter queues while running · Ctrl+S steers the next turn"
						: "Enter submits · / for commands · @ for files",
				)
			: null;

	const renderStatusBar = React.createElement(
		Box,
		{ flexDirection: "column", marginTop: 1 },
		React.createElement(
			Box,
			{ justifyContent: "space-between" },
			React.createElement(
				Text,
				{ color: "gray" },
				isConfigViewOpen
					? "Config mode: Tab tabs \u00b7 \u2191/\u2193 navigate \u00b7 Esc close"
					: undefined,
			),
			isConfigViewOpen
				? React.createElement(Text, { color: "gray" }, "(Esc)")
				: renderModeSelector,
		),
		renderQueueHint,
		React.createElement(
			Box,
			null,
			React.createElement(
				Text,
				null,
				`${config.providerId} ${config.modelId} `,
			),
			React.createElement(Text, null, contextBar.filled),
			React.createElement(Text, { color: "gray" }, contextBar.empty),
			React.createElement(
				Text,
				{ color: "gray" },
				` (${lastTotalTokens.toLocaleString()}) | $${lastTotalCost.toFixed(3)}`,
			),
		),
		React.createElement(
			Box,
			null,
			React.createElement(Text, null, workspaceName),
			gitBranch ? React.createElement(Text, null, ` (${gitBranch})`) : null,
			renderGitDiffStats,
		),
		renderAutoApprove,
	);

	const isMenuOpen =
		!isExitRequested &&
		!isConfigViewOpen &&
		(mentionInfo.inMentionMode || slashInfo.inSlashMode);

	return React.createElement(
		Box,
		{ flexDirection: "column", paddingX: 1 },
		renderWelcome,
		renderLines,
		renderInputBox,
		renderConfigView,
		renderMentionMenu,
		renderSlashMenu,
		isMenuOpen ? null : renderStatusBar,
	);
}
