import { basename } from "node:path";
import type { AgentEvent, TeamEvent } from "@clinebot/core";
import { Box, useInput } from "ink";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	PendingPromptSnapshot,
	PendingPromptSubmittedEvent,
} from "../runtime/session-events";
import { resolveStatusNoticeLabel } from "../utils/events";
import { truncate } from "../utils/helpers";
import { appendInputHistory, loadInputHistory } from "../utils/input-history";
import { type RepoStatus, readRepoStatus } from "../utils/repo-status";
import type { Config } from "../utils/types";
import {
	type ChatEntry,
	ChatMessageList,
	makeToolEndEntry,
	makeToolStartEntry,
} from "./components/ChatMessage";
import {
	CONFIG_TABS,
	ConfigView,
	getVisibleWindow,
	resolveActiveConfigItems,
} from "./components/ConfigView";
import { InputBox, type QueuedPromptItem } from "./components/InputBox";
import { MentionMenu } from "./components/MentionMenu";
import { SlashMenu } from "./components/SlashMenu";
import { StatusBar } from "./components/StatusBar";
import { WelcomeView } from "./components/WelcomeView";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	InteractiveConfigTab,
} from "./interactive-config";
import {
	type InteractiveSlashCommand,
	searchWorkspaceFilesForMention,
} from "./interactive-welcome";

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

interface InteractiveTuiProps {
	config: Config;
	initialView?: "chat" | "config";
	initialRepoStatus?: RepoStatus;
	workflowSlashCommands?: InteractiveSlashCommand[];
	loadAdditionalSlashCommands?: () => Promise<InteractiveSlashCommand[]>;
	loadWelcomeLine?: () => Promise<string | undefined>;
	loadConfigData: () => Promise<InteractiveConfigData>;
	onToggleConfigItem?: (
		item: InteractiveConfigItem,
	) => Promise<InteractiveConfigData | undefined>;
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

	// Chat entries — structured message history
	const [entries, setEntries] = useState<ChatEntry[]>([]);

	// Input & submission
	const [input, setInput] = useState("");
	const [cursorIndex, setCursorIndex] = useState(0);
	const [inputHistory, setInputHistory] = useState<string[]>(() =>
		loadInputHistory(),
	);
	const [historyIndex, setHistoryIndex] = useState(-1);
	const [isRunning, setIsRunning] = useState(false);
	const [isExitRequested, setIsExitRequested] = useState(false);
	const [abortRequested, setAbortRequested] = useState(false);
	const [hasSubmitted, setHasSubmitted] = useState(false);
	const [uiMode, setUiMode] = useState<"act" | "plan">(
		config.mode === "plan" ? "plan" : "act",
	);
	const [autoApproveAll, setAutoApproveAll] = useState(
		config.toolPolicies["*"]?.autoApprove !== false,
	);
	const [queuedPrompts, setQueuedPrompts] = useState<QueuedPromptItem[]>([]);
	const [welcomeLine, setWelcomeLine] = useState<string | undefined>(undefined);
	const [isWelcomeLinePending, setIsWelcomeLinePending] = useState(
		Boolean(props.loadWelcomeLine),
	);

	// File mention completion
	const [fileMentionResults, setFileMentionResults] = useState<string[]>([]);
	const [fileMentionSelectedIndex, setFileMentionSelectedIndex] = useState(0);
	const [isSearchingMentions, setIsSearchingMentions] = useState(false);

	// Slash command completion
	const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
	const [slashCommands, setSlashCommands] = useState<InteractiveSlashCommand[]>(
		() => props.workflowSlashCommands ?? [],
	);

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

	const activeConfigItems = useMemo(
		() => resolveActiveConfigItems(configData, configTab),
		[configData, configTab],
	);

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
		setConfigTab("tools");
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
		setSlashCommands(props.workflowSlashCommands ?? []);
	}, [props.workflowSlashCommands]);

	useEffect(() => {
		refreshRepoStatus();
	}, [refreshRepoStatus]);

	useEffect(() => {
		if (!props.loadAdditionalSlashCommands) {
			return;
		}
		let cancelled = false;
		void props
			.loadAdditionalSlashCommands()
			.then((additionalCommands) => {
				if (cancelled || additionalCommands.length === 0) {
					return;
				}
				setSlashCommands((current) => {
					const seen = new Set(current.map((command) => command.name));
					const next = [...current];
					for (const command of additionalCommands) {
						if (seen.has(command.name)) {
							continue;
						}
						seen.add(command.name);
						next.push(command);
					}
					return next;
				});
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [props.loadAdditionalSlashCommands]);

	useEffect(() => {
		if (!props.loadWelcomeLine) {
			setIsWelcomeLinePending(false);
			return;
		}
		let cancelled = false;
		setIsWelcomeLinePending(true);
		void props
			.loadWelcomeLine()
			.then((nextWelcomeLine) => {
				if (cancelled) {
					return;
				}
				setWelcomeLine(nextWelcomeLine?.trim() || undefined);
				setIsWelcomeLinePending(false);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setWelcomeLine(undefined);
				setIsWelcomeLinePending(false);
			});
		return () => {
			cancelled = true;
		};
	}, [props.loadWelcomeLine]);

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

	// Append a new ChatEntry to the structured history (capped at MAX_BUFFERED_LINES)
	const appendEntry = useCallback((entry: ChatEntry) => {
		setEntries((prev) => {
			const next = [...prev, entry];
			return next.length <= MAX_BUFFERED_LINES
				? next
				: next.slice(next.length - MAX_BUFFERED_LINES);
		});
	}, []);

	// Mutate the last entry in-place (for streaming text/reasoning updates)
	const updateLastEntry = useCallback(
		(updater: (prev: ChatEntry) => ChatEntry) => {
			setEntries((prev) => {
				if (prev.length === 0) return prev;
				const next = [...prev];
				next[next.length - 1] = updater(next[next.length - 1] as ChatEntry);
				return next;
			});
		},
		[],
	);

	const closeInlineStream = useCallback(() => {
		activeInlineStreamRef.current = undefined;
		// Mark the most recent streaming inline entry as no longer streaming.
		// Status/team rows can be appended after it before the stream closes.
		setEntries((prev) => {
			if (prev.length === 0) return prev;
			for (let index = prev.length - 1; index >= 0; index -= 1) {
				const entry = prev[index];
				if (
					entry &&
					(entry.kind === "assistant_text" ||
						entry.kind === "reasoning" ||
						entry.kind === "tool_start") &&
					entry.streaming
				) {
					const next = [...prev];
					next[index] = { ...entry, streaming: false } as ChatEntry;
					return next;
				}
			}
			return prev;
		});
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
								activeInlineStreamRef.current = "text";
								appendEntry({
									kind: "assistant_text",
									text: event.text ?? "",
									streaming: true,
								});
							} else {
								updateLastEntry((prev) =>
									prev.kind === "assistant_text"
										? { ...prev, text: prev.text + (event.text ?? "") }
										: prev,
								);
							}
							break;
						}
						case "reasoning": {
							const chunk =
								event.redacted && !event.reasoning
									? "[redacted]"
									: (event.reasoning ?? "");
							if (activeInlineStreamRef.current !== "reasoning") {
								closeInlineStream();
								activeInlineStreamRef.current = "reasoning";
								appendEntry({
									kind: "reasoning",
									text: chunk,
									streaming: true,
								});
							} else {
								updateLastEntry((prev) =>
									prev.kind === "reasoning"
										? { ...prev, text: prev.text + chunk }
										: prev,
								);
							}
							break;
						}
						case "tool": {
							closeInlineStream();
							appendEntry(
								makeToolStartEntry(
									event.toolName ?? "unknown_tool",
									event.input,
									true,
								),
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
							appendEntry(
								makeToolEndEntry(event.output, event.error ?? undefined),
							);
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
					if (!event.recoverable || config.verbose) {
						appendEntry({ kind: "error", text: event.error.message });
					}
					break;
				case "notice":
					if (event.displayRole === "status") {
						closeInlineStream();
						const label = resolveStatusNoticeLabel(event);
						if (label) {
							appendEntry({ kind: "status", text: label });
						}
					}
					break;
			}
		},
		[
			appendEntry,
			updateLastEntry,
			closeInlineStream,
			onTurnErrorReported,
			config.verbose,
		],
	);

	const handleTeamEvent = useCallback(
		(event: TeamEvent) => {
			const team = (text: string) => appendEntry({ kind: "team", text });
			switch (event.type) {
				case "teammate_spawned":
					team(`[team] teammate spawned: ${event.agentId}`);
					break;
				case "teammate_shutdown":
					team(`[team] teammate shutdown: ${event.agentId}`);
					break;
				case "team_task_updated":
					team(`[team task] ${event.task.id} -> ${event.task.status}`);
					break;
				case "team_message":
					team(
						`[mailbox] ${event.message.fromAgentId} -> ${event.message.toAgentId}: ${event.message.subject}`,
					);
					break;
				case "team_mission_log":
					team(
						`[mission] ${event.entry.agentId}: ${truncate(event.entry.summary, 90)}`,
					);
					break;
				case "run_queued":
					team(`[team run] queued ${event.run.id} -> ${event.run.agentId} ...`);
					break;
				case "run_started":
					team(
						`[team run] started ${event.run.id} -> ${event.run.agentId} ...`,
					);
					break;
				case "run_progress":
					if (event.message === "heartbeat") break;
					team(`[team run] progress ${event.run.id}: ${event.message}`);
					break;
				case "run_completed":
					team(`[team run] completed ${event.run.id}`);
					break;
				case "run_failed":
					team(
						`[team run] failed ${event.run.id}: ${event.run.error ?? "unknown error"}`,
					);
					break;
				case "run_cancelled":
					team(`[team run] cancelled ${event.run.id}`);
					break;
				case "run_interrupted":
					team(`[team run] interrupted ${event.run.id}`);
					break;
				case "outcome_created":
					team(
						`[team outcome] created ${event.outcome.id}: ${event.outcome.title}`,
					);
					break;
				case "outcome_fragment_attached":
					team(
						`[team outcome] fragment ${event.fragment.id} attached to ${event.fragment.section}`,
					);
					break;
				case "outcome_fragment_reviewed":
					team(
						`[team outcome] fragment ${event.fragment.id} -> ${event.fragment.status}`,
					);
					break;
				case "outcome_finalized":
					team(`[team outcome] finalized ${event.outcome.id}`);
					break;
				case "task_start":
				case "task_end":
				case "agent_event":
					break;
			}
		},
		[appendEntry],
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
			appendEntry({ kind: "user_submitted", text: event.prompt });
		},
		[appendEntry],
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
		setCursorIndex(0);
		setIsExitRequested(true);
	}, []);

	const submitPrompt = useCallback(
		async (prompt: string, delivery?: "queue" | "steer") => {
			if (!prompt.trim()) {
				return;
			}
			setHasSubmitted(true);
			if (!delivery) {
				setIsRunning(true);
				setAbortRequested(false);
				turnErrorReportedRef.current = false;
				onTurnErrorReported(false);
			}
			appendEntry({ kind: "user_submitted", text: prompt, delivery });
			setInput("");
			setCursorIndex(0);
			if (!delivery) {
				appendInputHistory(prompt);
				setInputHistory((prev) => [prompt, ...prev]);
				setHistoryIndex(-1);
			}

			const startedAt = performance.now();
			try {
				const result = await onSubmit(prompt, uiMode, delivery);
				if (result.commandOutput) {
					appendEntry({ kind: "status", text: result.commandOutput });
				}
				if (result.queued) {
					return;
				}
				const tokens = result.usage.inputTokens + result.usage.outputTokens;
				setLastTotalTokens(tokens);
				if (typeof result.usage.totalCost === "number") {
					setLastTotalCost(result.usage.totalCost);
				}
				if (!result.commandOutput && config.showUsage) {
					const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
					appendEntry({
						kind: "done",
						tokens: config.showUsage ? tokens : 0,
						cost:
							config.showUsage && typeof result.usage.totalCost === "number"
								? result.usage.totalCost
								: 0,
						elapsed,
						iterations: result.iterations,
					});
				}
			} catch (error) {
				if (!turnErrorReportedRef.current) {
					appendEntry({
						kind: "error",
						text: error instanceof Error ? error.message : String(error),
					});
				}
			} finally {
				if (!delivery) {
					closeInlineStream();
					setIsRunning(false);
					refreshRepoStatus();
				}
			}
		},
		[
			appendEntry,
			closeInlineStream,
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
			const currentTabIndex = CONFIG_TABS.indexOf(configTab);
			if (key.escape || (key.ctrl && value === "d")) {
				closeConfigView();
				return;
			}
			if (key.ctrl && value === "c") {
				closeConfigView();
				return;
			}
			if (key.leftArrow || key.rightArrow) {
				const nextIndex =
					currentTabIndex < 0
						? 0
						: key.leftArrow
							? (currentTabIndex - 1 + CONFIG_TABS.length) % CONFIG_TABS.length
							: (currentTabIndex + 1) % CONFIG_TABS.length;
				setConfigTab(CONFIG_TABS[nextIndex] ?? "tools");
				setConfigSelectedIndex(0);
				return;
			}
			if (value >= "1" && value <= "8") {
				const requestedIndex = Number.parseInt(value, 10) - 1;
				const nextTab = CONFIG_TABS[requestedIndex];
				if (nextTab) {
					setConfigTab(nextTab);
					setConfigSelectedIndex(0);
				}
				return;
			}
			if (key.upArrow || value === "k") {
				if (activeConfigItems.length > 0) {
					setConfigSelectedIndex((prev) =>
						prev > 0 ? prev - 1 : activeConfigItems.length - 1,
					);
				}
				return;
			}
			if (key.downArrow || value === "j") {
				if (activeConfigItems.length > 0) {
					setConfigSelectedIndex((prev) =>
						prev < activeConfigItems.length - 1 ? prev + 1 : 0,
					);
				}
				return;
			}
			if (key.return) {
				const selected = activeConfigItems[configSelectedIndex];
				if (
					selected &&
					configTab === "tools" &&
					(selected.source === "workspace-plugin" ||
						selected.source === "global-plugin")
				) {
					setIsLoadingConfig(true);
					void props
						.onToggleConfigItem?.(selected)
						.then((nextData) => {
							if (nextData) {
								setConfigData(nextData);
							}
						})
						.finally(() => {
							setIsLoadingConfig(false);
						});
					return;
				}
				if (selected && configTab === "skills") {
					const nextInput = `/${selected.name} `;
					setInput(nextInput);
					setCursorIndex(nextInput.length);
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
					setInput((prev) => {
						const nextInput = insertMention(
							prev,
							extractMentionQuery(prev).atIndex,
							selectedPath,
						);
						setCursorIndex(nextInput.length);
						return nextInput;
					});
				}
				return;
			}
			if (hasSlashMenu) {
				const selectedCommand = slashResults[slashSelectedIndex];
				if (selectedCommand) {
					setInput((prev) => {
						const nextInput = insertSlashCommand(
							prev,
							extractSlashQuery(prev).slashIndex,
							selectedCommand.name,
						);
						setCursorIndex(nextInput.length);
						return nextInput;
					});
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
					appendEntry({ kind: "status", text: "abort requested" });
					return;
				}
				requestExit();
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
					setInput((prev) => {
						const nextInput = insertMention(
							prev,
							extractMentionQuery(prev).atIndex,
							selectedPath,
						);
						setCursorIndex(nextInput.length);
						return nextInput;
					});
				}
				return;
			}
			if (hasSlashMenu) {
				const selectedCommand = slashResults[slashSelectedIndex];
				if (selectedCommand) {
					setInput((prev) => {
						const nextInput = insertSlashCommand(
							prev,
							extractSlashQuery(prev).slashIndex,
							selectedCommand.name,
						);
						setCursorIndex(nextInput.length);
						return nextInput;
					});
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

		const isBackwardDelete =
			key.backspace ||
			value === "\u007f" ||
			value === "\b" ||
			(key.ctrl && value === "h") ||
			(key.delete && !value.includes("\u001b"));
		const isForwardDelete = key.delete && value.includes("\u001b");
		if (isBackwardDelete || isForwardDelete) {
			setHistoryIndex(-1);
			if (isBackwardDelete) {
				setInput((prev) => {
					if (cursorIndex <= 0) {
						return prev;
					}
					return prev.slice(0, cursorIndex - 1) + prev.slice(cursorIndex);
				});
				setCursorIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			setInput(
				(prev) => prev.slice(0, cursorIndex) + prev.slice(cursorIndex + 1),
			);
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
			if ((input === "" || historyIndex >= 0) && inputHistory.length > 0) {
				setHistoryIndex((prev) => {
					const next = Math.min(prev + 1, inputHistory.length - 1);
					const nextInput = inputHistory[next] ?? "";
					setInput(nextInput);
					setCursorIndex(nextInput.length);
					return next;
				});
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
			if (historyIndex >= 0) {
				setHistoryIndex((prev) => {
					const next = prev - 1;
					const nextInput = next < 0 ? "" : (inputHistory[next] ?? "");
					setInput(nextInput);
					setCursorIndex(nextInput.length);
					return next;
				});
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
			setCursorIndex((prev) =>
				key.leftArrow
					? Math.max(0, prev - 1)
					: Math.min(input.length, prev + 1),
			);
			return;
		}

		if (
			!key.ctrl &&
			!key.meta &&
			value.length > 0 &&
			!value.includes("\u001b")
		) {
			setHistoryIndex(-1);
			setInput((prev) => {
				const nextInput =
					prev.slice(0, cursorIndex) + value + prev.slice(cursorIndex);
				return nextInput;
			});
			setCursorIndex((prev) => prev + value.length);
		}
	});

	useEffect(() => {
		setCursorIndex((prev) => Math.min(prev, input.length));
	}, [input]);

	const visibleEntries = useMemo(
		() => entries.slice(-maxVisibleLines),
		[entries, maxVisibleLines],
	);
	const shouldShowWelcome =
		!isConfigViewOpen && !hasSubmitted && entries.length === 0;
	const visibleMentionResults = useMemo(
		() => getVisibleWindow(fileMentionResults, fileMentionSelectedIndex),
		[fileMentionResults, fileMentionSelectedIndex],
	);
	const visibleSlashResults = useMemo(
		() => getVisibleWindow(filteredSlashCommands, slashSelectedIndex),
		[filteredSlashCommands, slashSelectedIndex],
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
				welcomeLine,
				welcomeLinePending: isWelcomeLinePending,
			})
		: null;

	const renderLines = !isConfigViewOpen
		? React.createElement(ChatMessageList, { entries: visibleEntries })
		: null;

	const renderInputBox =
		!isConfigViewOpen && !isExitRequested
			? React.createElement(InputBox, {
					input,
					cursor: cursorIndex,
					queuedPrompts,
				})
			: null;

	const renderConfigView = isConfigViewOpen
		? React.createElement(ConfigView, {
				configTab,
				configSelectedIndex,
				activeConfigItems,
				isLoadingConfig,
			})
		: null;

	const renderMentionMenu =
		!isExitRequested && !isConfigViewOpen && mentionInfo.inMentionMode
			? React.createElement(MentionMenu, {
					query: mentionInfo.query,
					isSearching: isSearchingMentions,
					results: fileMentionResults,
					selectedIndex: fileMentionSelectedIndex,
					visibleWindow: visibleMentionResults,
				})
			: null;

	const renderSlashMenu =
		!isExitRequested &&
		!isConfigViewOpen &&
		!mentionInfo.inMentionMode &&
		slashInfo.inSlashMode
			? React.createElement(SlashMenu, {
					query: slashInfo.query,
					commands: filteredSlashCommands,
					selectedIndex: slashSelectedIndex,
					visibleWindow: visibleSlashResults,
				})
			: null;

	const renderStatusBar = React.createElement(StatusBar, {
		isConfigViewOpen,
		isRunning,
		isExitRequested,
		uiMode,
		providerId: config.providerId,
		modelId: config.modelId,
		contextBar,
		lastTotalTokens,
		lastTotalCost,
		workspaceName,
		gitBranch,
		gitDiffStats,
		autoApproveAll,
	});

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
