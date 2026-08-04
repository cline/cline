"use client";

import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared/browser";
import { AgentPromptQueue, SearchCombobox } from "@cline/ui";
import {
	ArrowUp,
	Brain,
	ChevronDown,
	CircleStop,
	Cpu,
	Paperclip,
	X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/contexts/workspace-context";
import type { PromptInQueue } from "@/hooks/chat-session/types";
import { formatCostUsd } from "@/hooks/use-session-history";
import type { ChatSessionConfig, ChatSessionStatus } from "@/lib/chat-schema";
import { desktopClient } from "@/lib/desktop-client";
import {
	readModelSelectionStorageFromWindow,
	writeModelSelectionStorageToWindow,
} from "@/lib/model-selection";
import { normalizeProviderId } from "@/lib/provider-id";
import {
	loadProviderModelCatalog,
	loadProviderModels,
} from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";
import { WorkspaceSelector as WorkspaceSelectorImpl } from "./workspace-selector";

// Memoized: the workspace/branch selector fans out into popovers and lists
// that should not re-render for every keystroke in the composer textarea.
const WorkspaceSelector = memo(WorkspaceSelectorImpl);

type ActiveMention = {
	start: number;
	end: number;
	query: string;
};

type ActiveSlash = {
	slashIndex: number;
	query: string;
};

type SlashCommand = {
	name: string;
	description?: string;
};

const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
	{
		name: "fork",
		description: "Create a copy of the current session into a new session",
	},
	{ name: "team", description: "Start the task with an agent team" },
];

const FALLBACK_PROVIDER_MODELS: Record<string, string[]> = {
	cline: [CLINE_DEFAULT_MODEL_ID],
	anthropic: ["claude-sonnet-4-6"],
	"openai-native": ["gpt-5.5"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-3-pro-latest"],
};

const FALLBACK_PROVIDER_REASONING_MODELS: Record<string, string[]> = {
	cline: [CLINE_DEFAULT_MODEL_ID],
	anthropic: ["claude-sonnet-4-6"],
	"openai-native": ["gpt-5.5"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-3-pro-latest"],
};

type ReasoningEffort = NonNullable<ChatSessionConfig["reasoningEffort"]>;
type ReasoningEffortOption = {
	label: string;
	value: "none" | ReasoningEffort;
};

const DEFAULT_REASONING_EFFORT: ReasoningEffortOption = {
	label: "Low",
	value: "low",
};

const EFFORT_LEVELS: ReasoningEffortOption[] = [
	{ label: "None", value: "none" },
	DEFAULT_REASONING_EFFORT,
	{ label: "Medium", value: "medium" },
	{ label: "High", value: "high" },
	{ label: "Extra", value: "xhigh" },
];
const PROMPT_INPUT_COLLAPSED_ROWS = 1;
const PROMPT_INPUT_EXPANDED_ROWS = 2;
const PROMPT_INPUT_MAX_ROWS = 5;
const PROMPT_INPUT_LINE_HEIGHT_REM = 1.25;

function resolveEffortIndex(
	thinking: ChatSessionConfig["thinking"],
	reasoningEffort: ChatSessionConfig["reasoningEffort"],
): number {
	if (thinking === false) {
		return 0;
	}
	const index = EFFORT_LEVELS.findIndex(
		(option) => option.value === reasoningEffort,
	);
	return index >= 0 ? index : 1;
}

function buildReasoningConfig(
	option: ReasoningEffortOption,
): Pick<ChatSessionConfig, "thinking" | "reasoningEffort"> {
	if (option.value === "none") {
		return { thinking: false, reasoningEffort: undefined };
	}
	return { thinking: true, reasoningEffort: option.value };
}

function hasReasoningCapability(
	providerReasoningModels: Record<string, string[]>,
	provider: string,
	model: string,
): boolean {
	const normalizedProvider = normalizeProviderId(provider);
	return (
		providerReasoningModels[normalizedProvider] ??
		providerReasoningModels[provider] ??
		[]
	).includes(model);
}

function getActiveMention(input: string, cursor: number): ActiveMention | null {
	if (cursor < 0 || cursor > input.length) {
		return null;
	}
	const left = input.slice(0, cursor);
	const atIndex = left.lastIndexOf("@");
	if (atIndex === -1) {
		return null;
	}
	const before = atIndex === 0 ? "" : left[atIndex - 1];
	if (before && !/\s/.test(before)) {
		return null;
	}
	const mentionBody = left.slice(atIndex + 1);
	if (!/^[^\s@]*$/.test(mentionBody)) {
		return null;
	}
	return {
		start: atIndex,
		end: cursor,
		query: mentionBody,
	};
}

function getActiveSlash(input: string, cursor: number): ActiveSlash | null {
	if (cursor < 0 || cursor > input.length) {
		return null;
	}
	const left = input.slice(0, cursor);
	const slashIndex = left.lastIndexOf("/");
	if (slashIndex === -1) {
		return null;
	}
	// Slash must be at the start or preceded by whitespace.
	if (slashIndex > 0 && !/\s/.test(left[slashIndex - 1] ?? "")) {
		return null;
	}
	const query = left.slice(slashIndex + 1);
	// No whitespace allowed inside the query — once the user typed a space
	// the slash command has been committed.
	if (/\s/.test(query)) {
		return null;
	}
	// Don't open slash mode if there's already a completed slash command earlier in the input.
	const firstSlashCommandRegex = /(^|\s)\/[a-zA-Z0-9_.-]+\s/;
	const textBeforeCurrentSlash = input.slice(0, slashIndex);
	if (firstSlashCommandRegex.test(textBeforeCurrentSlash)) {
		return null;
	}
	return { slashIndex, query };
}

/**
 * Externally injected composer text (quick actions, queue undo, resets).
 * The live keystroke state stays local to ChatInputBar so typing never
 * re-renders the whole page tree; bump `version` to push a new value in.
 */
export type PromptDraft = {
	version: number;
	value: string;
};

type ChatInputBarProps = {
	variant?: "conversation" | "welcome";
	status: ChatSessionStatus;
	provider: string;
	model: string;
	modelContextWindow?: number;
	mode: "act" | "plan";
	thinking: ChatSessionConfig["thinking"];
	reasoningEffort: ChatSessionConfig["reasoningEffort"];
	gitBranch: string;
	promptDraft: PromptDraft;
	onPromptInputChange: (value: string) => void;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModeToggle: () => void;
	onReasoningChange: (
		next: Pick<ChatSessionConfig, "thinking" | "reasoningEffort">,
	) => void;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
	onSend: (prompt: string) => void;
	onAbort: () => void;
	promptsInQueue: PromptInQueue[];
	attachments: Array<{ id: string; name: string; isImage: boolean }>;
	onAttachFiles: (files: File[]) => void;
	onRemoveAttachment: (id: string) => void;
	onSteerPromptInQueue: (promptId: string) => Promise<void> | void;
	onEditPromptInQueue: (
		promptId: string,
		prompt: string,
	) => Promise<void> | void;
	onRemovePromptInQueue: (promptId: string) => Promise<void> | void;
	summary: {
		toolCalls: number;
		tokensIn: number;
		tokensOut: number;
		totalCostUsd?: number;
	};
};

export function ChatInputBar({
	variant = "conversation",
	status,
	provider,
	model,
	modelContextWindow,
	mode,
	thinking,
	reasoningEffort,
	gitBranch,
	promptDraft,
	onPromptInputChange,
	onProviderChange,
	onModelChange,
	onModeToggle,
	onReasoningChange,
	onListGitBranches,
	onSwitchGitBranch,
	onSend,
	onAbort,
	promptsInQueue,
	attachments,
	onAttachFiles,
	onRemoveAttachment,
	onSteerPromptInQueue,
	onEditPromptInQueue,
	onRemovePromptInQueue,
	summary,
}: ChatInputBarProps) {
	const {
		workspaceRoot,
		workspaces,
		refreshWorkspaces: onRefreshWorkspaces,
		switchWorkspace: onSwitchWorkspace,
		pickWorkspaceDirectory: onPickWorkspaceDirectory,
	} = useWorkspace();
	// Keystrokes only update this local state; the parent page tree is not
	// re-rendered per keypress. External writers push text in via promptDraft.
	const [promptInput, setPromptInputState] = useState(promptDraft.value);
	const appliedDraftVersionRef = useRef(promptDraft.version);
	const setPromptInput = useCallback(
		(value: string) => {
			setPromptInputState(value);
			onPromptInputChange(value);
		},
		[onPromptInputChange],
	);
	useEffect(() => {
		if (appliedDraftVersionRef.current === promptDraft.version) {
			return;
		}
		appliedDraftVersionRef.current = promptDraft.version;
		setPromptInput(promptDraft.value);
	}, [promptDraft, setPromptInput]);
	const isBusy =
		status === "starting" || status === "running" || status === "stopping";
	const canAbort = status === "running" || status === "stopping";
	const hasDraft = promptInput.trim().length > 0 || attachments.length > 0;

	const [reasoningCapability, setReasoningCapability] = useState<{
		provider: string;
		model: string;
		supported: boolean | null;
	} | null>(null);
	const modelSupportsReasoning =
		reasoningCapability?.provider === provider &&
		reasoningCapability.model === model
			? reasoningCapability.supported
			: null;
	const handleModelSupportsReasoningChange = useCallback(
		(supported: boolean | null) => {
			setReasoningCapability((current) => {
				if (
					current?.provider === provider &&
					current.model === model &&
					current.supported === supported
				) {
					return current;
				}
				return { provider, model, supported };
			});
		},
		[model, provider],
	);
	const canSend = hasDraft;
	const handleSend = useCallback(() => {
		const prompt = promptInput.trim();
		setPromptInput("");
		onSend(prompt);
	}, [onSend, promptInput, setPromptInput]);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
	const [promptInputFocused, setPromptInputFocused] = useState(false);
	const [cursorIndex, setCursorIndex] = useState(() => promptInput.length);
	// Mention/slash detection is derived synchronously from the input +
	// cursor. Deriving (rather than syncing through effects) keeps a keystroke
	// at a single render commit; only an explicit Escape dismissal is state.
	const activeMention = useMemo(
		() => getActiveMention(promptInput, cursorIndex),
		[promptInput, cursorIndex],
	);
	const [dismissedMentionKey, setDismissedMentionKey] = useState<string | null>(
		null,
	);
	const mentionKey = activeMention
		? `${activeMention.start}:${activeMention.query}`
		: null;
	const mentionOpen = mentionKey !== null && dismissedMentionKey !== mentionKey;
	const [mentionFiles, setMentionFiles] = useState<string[]>([]);
	const [mentionLoading, setMentionLoading] = useState(false);
	const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
	const mentionResultsCacheRef = useRef(new Map<string, string[]>());
	const mentionLastRequestKeyRef = useRef<string | null>(null);

	// ---- Slash command state ----
	const activeSlash = useMemo(
		() => getActiveSlash(promptInput, cursorIndex),
		[promptInput, cursorIndex],
	);
	const [dismissedSlashKey, setDismissedSlashKey] = useState<string | null>(
		null,
	);
	const slashKey = activeSlash
		? `${activeSlash.slashIndex}:${activeSlash.query}`
		: null;
	const slashOpen = slashKey !== null && dismissedSlashKey !== slashKey;
	const [slashCommands, setSlashCommands] = useState<SlashCommand[]>(
		BUILTIN_SLASH_COMMANDS,
	);
	const [slashLoading, setSlashLoading] = useState(false);
	const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
	const slashCommandsLoadedRef = useRef(false);

	const effortIndex = useMemo(
		() => resolveEffortIndex(thinking, reasoningEffort),
		[reasoningEffort, thinking],
	);
	const hasExplicitReasoningSelection =
		thinking !== undefined || reasoningEffort !== undefined;
	const effortLabel =
		!hasExplicitReasoningSelection && modelSupportsReasoning === null
			? "Reasoning"
			: !hasExplicitReasoningSelection && modelSupportsReasoning === false
				? "None"
				: (EFFORT_LEVELS[effortIndex]?.label ?? "Reasoning");
	const promptInputRows =
		variant === "welcome" || promptInputFocused
			? PROMPT_INPUT_EXPANDED_ROWS
			: PROMPT_INPUT_COLLAPSED_ROWS;
	const handleEffortChange = useCallback(
		(value: string) => {
			if (modelSupportsReasoning !== true) {
				return;
			}
			const nextOption = EFFORT_LEVELS.find((option) => option.value === value);
			if (nextOption) {
				onReasoningChange(buildReasoningConfig(nextOption));
			}
		},
		[modelSupportsReasoning, onReasoningChange],
	);

	useEffect(() => {
		if (
			modelSupportsReasoning === true &&
			thinking === undefined &&
			reasoningEffort === undefined
		) {
			onReasoningChange(buildReasoningConfig(DEFAULT_REASONING_EFFORT));
		}
	}, [modelSupportsReasoning, onReasoningChange, reasoningEffort, thinking]);

	useEffect(() => {
		const input = promptInputRef.current;
		if (!input) return;
		if (
			variant === "conversation" ||
			(variant === "welcome" &&
				promptInput.trim().length > 0 &&
				document.activeElement !== input)
		) {
			input.focus();
		}
	}, [promptInput, variant]);

	useEffect(() => {
		setCursorIndex((prev) => Math.min(prev, promptInput.length));
	}, [promptInput.length]);

	useEffect(() => {
		if (!mentionOpen || !activeMention) {
			setMentionFiles([]);
			setMentionLoading(false);
			setMentionSelectedIndex(0);
			return;
		}

		const requestKey = `${workspaceRoot}::${activeMention.query}`;
		if (mentionLastRequestKeyRef.current === requestKey) {
			return;
		}
		mentionLastRequestKeyRef.current = requestKey;
		const cached = mentionResultsCacheRef.current.get(requestKey);
		if (cached) {
			setMentionFiles(cached);
			setMentionSelectedIndex(0);
			setMentionLoading(false);
			return;
		}

		let cancelled = false;
		const timeoutId = window.setTimeout(async () => {
			if (mentionFiles.length === 0) {
				setMentionLoading(true);
			}
			try {
				const results = await desktopClient.invoke<string[]>(
					"search_workspace_files",
					{
						workspaceRoot,
						query: activeMention.query,
						limit: 10,
					},
				);
				if (cancelled) {
					return;
				}
				const nextResults = Array.isArray(results) ? results : [];
				mentionResultsCacheRef.current.set(requestKey, nextResults);
				setMentionFiles(nextResults);
				setMentionSelectedIndex(0);
			} catch {
				if (cancelled) {
					return;
				}
				if (mentionFiles.length === 0) {
					setMentionFiles([]);
				}
			} finally {
				if (!cancelled) {
					setMentionLoading(false);
				}
			}
		}, 120);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [activeMention, mentionOpen, workspaceRoot, mentionFiles.length]);

	const insertMentionFile = useCallback(
		(filePath: string) => {
			if (!activeMention) {
				return;
			}
			const nextValue =
				`${promptInput.slice(0, activeMention.start)}@${filePath} ` +
				promptInput.slice(activeMention.end);
			// The menu closes on its own: the inserted trailing space ends the
			// active mention, so the derived `mentionOpen` turns false.
			setPromptInput(nextValue);
			const nextCursor = activeMention.start + filePath.length + 2;
			requestAnimationFrame(() => {
				const input = promptInputRef.current;
				if (!input) {
					return;
				}
				input.focus();
				input.setSelectionRange(nextCursor, nextCursor);
				setCursorIndex(nextCursor);
			});
		},
		[activeMention, promptInput, setPromptInput],
	);

	// ---- Slash command effects ----

	// Reset selection index when slash menu opens/closes.
	useEffect(() => {
		if (!slashOpen) {
			setSlashSelectedIndex(0);
		}
	}, [slashOpen]);

	// Lazily load workflow commands from the sidecar the first time the slash
	// menu opens, then merge with the built-in commands.
	useEffect(() => {
		if (!slashOpen || slashCommandsLoadedRef.current) {
			return;
		}
		slashCommandsLoadedRef.current = true;
		let cancelled = false;
		setSlashLoading(true);
		desktopClient
			.invoke<{
				workflows?: Array<{ id: string; name: string }>;
			}>("list_user_instruction_configs")
			.then((response: { workflows?: Array<{ id: string; name: string }> }) => {
				if (cancelled) return;
				const workflows = Array.isArray(response?.workflows)
					? response.workflows
					: [];
				const workflowCommands: SlashCommand[] = workflows.map(
					(w: { id: string; name: string }) => ({
						name: w.name.toLowerCase().replace(/\s+/g, "-"),
						description: "Workflow command",
					}),
				);
				const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((c) => c.name));
				const dedupedWorkflows = workflowCommands.filter(
					(c) => !builtinNames.has(c.name),
				);
				setSlashCommands([...BUILTIN_SLASH_COMMANDS, ...dedupedWorkflows]);
			})
			.catch(() => {
				// Keep built-in commands on error.
			})
			.finally(() => {
				if (!cancelled) setSlashLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [slashOpen]);

	// Filtered slash commands based on the current query.
	const filteredSlashCommands = useMemo(() => {
		if (!slashOpen) return [];
		const query = (activeSlash?.query ?? "").trim().toLowerCase();
		if (!query) {
			return slashCommands.slice(0, 10);
		}
		return slashCommands
			.filter((cmd) => cmd.name.toLowerCase().includes(query))
			.sort((a, b) => {
				const aStarts = a.name.toLowerCase().startsWith(query);
				const bStarts = b.name.toLowerCase().startsWith(query);
				if (aStarts && !bStarts) return -1;
				if (!aStarts && bStarts) return 1;
				return a.name.localeCompare(b.name);
			})
			.slice(0, 10);
	}, [slashOpen, activeSlash?.query, slashCommands]);

	const insertSlashCommandItem = useCallback(
		(commandName: string) => {
			if (!activeSlash) return;
			const nextValue = `${promptInput.slice(0, activeSlash.slashIndex)}/${commandName} `;
			// Closes via derivation: the trailing space ends the slash command.
			setPromptInput(nextValue);
			const nextCursor = activeSlash.slashIndex + commandName.length + 2;
			requestAnimationFrame(() => {
				const input = promptInputRef.current;
				if (!input) return;
				input.focus();
				input.setSelectionRange(nextCursor, nextCursor);
				setCursorIndex(nextCursor);
			});
		},
		[activeSlash, promptInput, setPromptInput],
	);

	return (
		<div
			className={cn(
				"bg-card",
				variant === "welcome"
					? "overflow-visible rounded-xl border border-border/90 bg-card/90 shadow-[0_24px_80px_-56px_color-mix(in_oklab,var(--primary)_72%,transparent)] backdrop-blur-md"
					: "border-t border-border bg-card/95 backdrop-blur-sm",
			)}
		>
			{/* Input area */}
			<div className={cn("px-4 py-3", variant === "welcome" && "pb-2 pt-4")}>
				<AgentPromptQueue
					items={promptsInQueue}
					onEdit={onEditPromptInQueue}
					onRemove={onRemovePromptInQueue}
					onSteer={onSteerPromptInQueue}
				/>
				<div className="relative">
					{slashOpen && (
						<div
							className="absolute inset-x-0 bottom-full z-50 mb-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl"
							id="slash-command-suggestions"
							role="listbox"
						>
							{filteredSlashCommands.length === 0 ? (
								<div className="px-3 py-2 text-xs text-muted-foreground">
									{slashLoading
										? "Loading commands..."
										: "No matching commands"}
								</div>
							) : (
								<>
									{filteredSlashCommands.map((cmd, index) => (
										<button
											aria-selected={index === slashSelectedIndex}
											className={cn(
												"flex w-full flex-col rounded-md px-3 py-2 text-left text-xs transition-colors",
												index === slashSelectedIndex
													? "bg-accent text-foreground"
													: "text-muted-foreground hover:bg-accent hover:text-foreground",
											)}
											key={cmd.name}
											id={`slash-command-option-${index}`}
											onClick={() => insertSlashCommandItem(cmd.name)}
											role="option"
											type="button"
										>
											<span className="font-medium">/{cmd.name}</span>
											{cmd.description && (
												<span className="text-[10px] opacity-70">
													{cmd.description}
												</span>
											)}
										</button>
									))}
									{slashLoading && (
										<div className="px-3 py-1 text-[10px] text-muted-foreground">
											Loading...
										</div>
									)}
								</>
							)}
						</div>
					)}
					{mentionOpen && (
						<div
							className="absolute inset-x-0 bottom-full z-50 mb-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl"
							id="mention-file-suggestions"
							role="listbox"
						>
							{mentionFiles.length === 0 ? (
								<div className="px-3 py-2 text-xs text-muted-foreground">
									{mentionLoading ? "Searching files..." : "No matching files"}
								</div>
							) : (
								<>
									{mentionFiles.map((filePath, index) => (
										<button
											aria-selected={index === mentionSelectedIndex}
											className={cn(
												"block w-full rounded-md px-3 py-2 text-left text-xs transition-colors",
												index === mentionSelectedIndex
													? "bg-accent text-foreground"
													: "text-muted-foreground hover:bg-accent hover:text-foreground",
											)}
											key={filePath}
											id={`mention-file-option-${index}`}
											onClick={() => insertMentionFile(filePath)}
											role="option"
											type="button"
										>
											{filePath}
										</button>
									))}
									{mentionLoading && (
										<div className="px-3 py-1 text-[10px] text-muted-foreground">
											Updating...
										</div>
									)}
								</>
							)}
						</div>
					)}
					<div
						className={cn(
							"flex items-end gap-2 rounded-lg border border-border bg-background px-3 py-2.5 transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20",
							variant === "welcome" &&
								"min-h-16 rounded-none border-0 bg-transparent px-0 py-0 focus-within:ring-0",
						)}
					>
						<textarea
							aria-activedescendant={
								slashOpen && filteredSlashCommands.length > 0
									? `slash-command-option-${slashSelectedIndex}`
									: mentionOpen && mentionFiles.length > 0
										? `mention-file-option-${mentionSelectedIndex}`
										: undefined
							}
							aria-autocomplete="list"
							aria-controls={
								slashOpen
									? "slash-command-suggestions"
									: mentionOpen
										? "mention-file-suggestions"
										: undefined
							}
							aria-expanded={slashOpen || mentionOpen}
							aria-haspopup="listbox"
							className={cn(
								"field-sizing-content flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-5 text-foreground placeholder:text-muted-foreground outline-none",
							)}
							onChange={(e) => {
								setPromptInput(e.target.value);
								setCursorIndex(
									e.target.selectionStart ?? e.target.value.length,
								);
							}}
							onClick={(e) =>
								setCursorIndex(
									e.currentTarget.selectionStart ?? promptInput.length,
								)
							}
							onBlur={() => setPromptInputFocused(false)}
							onFocus={() => setPromptInputFocused(true)}
							onKeyDown={(e) => {
								// Slash command menu takes priority when open.
								if (slashOpen && filteredSlashCommands.length > 0) {
									if (e.key === "ArrowDown") {
										e.preventDefault();
										setSlashSelectedIndex(
											(prev) => (prev + 1) % filteredSlashCommands.length,
										);
										return;
									}
									if (e.key === "ArrowUp") {
										e.preventDefault();
										setSlashSelectedIndex(
											(prev) =>
												(prev - 1 + filteredSlashCommands.length) %
												filteredSlashCommands.length,
										);
										return;
									}
									if (e.key === "Enter" || e.key === "Tab") {
										e.preventDefault();
										const selected = filteredSlashCommands[slashSelectedIndex];
										if (selected) {
											insertSlashCommandItem(selected.name);
										}
										return;
									}
								}
								if (slashOpen && e.key === "Escape") {
									e.preventDefault();
									setDismissedSlashKey(slashKey);
									return;
								}
								if (mentionOpen && mentionFiles.length > 0) {
									if (e.key === "ArrowDown") {
										e.preventDefault();
										setMentionSelectedIndex(
											(prev) => (prev + 1) % mentionFiles.length,
										);
										return;
									}
									if (e.key === "ArrowUp") {
										e.preventDefault();
										setMentionSelectedIndex(
											(prev) =>
												(prev - 1 + mentionFiles.length) % mentionFiles.length,
										);
										return;
									}
									if (e.key === "Enter" || e.key === "Tab") {
										e.preventDefault();
										insertMentionFile(mentionFiles[mentionSelectedIndex]);
										return;
									}
								}
								if (mentionOpen && e.key === "Escape") {
									e.preventDefault();
									setDismissedMentionKey(mentionKey);
									return;
								}
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									if (canSend) {
										handleSend();
									}
								}
							}}
							onKeyUp={(e) =>
								setCursorIndex(
									e.currentTarget.selectionStart ?? promptInput.length,
								)
							}
							placeholder={
								variant === "welcome"
									? "Ask to make changes, @mention files, reference #PRs, or run /commands."
									: isBusy
										? "Agent is working... submit to queue another message"
										: "Enter your question or type / for commands or @ for context"
							}
							ref={promptInputRef}
							role="combobox"
							rows={promptInputRows}
							style={{
								maxHeight: `${PROMPT_INPUT_MAX_ROWS * PROMPT_INPUT_LINE_HEIGHT_REM}rem`,
								minHeight: `${promptInputRows * PROMPT_INPUT_LINE_HEIGHT_REM}rem`,
							}}
							value={promptInput}
						/>
						<div className="flex shrink-0 items-center gap-2">
							{canAbort && (
								<button
									aria-label="Stop agent"
									className={cn(
										"bg-foreground p-0 text-background transition-colors hover:bg-primary/80",
										variant === "welcome" ? "rounded-md" : "rounded-full",
									)}
									onClick={onAbort}
									type="button"
								>
									<CircleStop className="size-2" />
								</button>
							)}
							{(!isBusy || canSend) && (
								<button
									aria-label="Send message"
									className={cn(
										"p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
										variant === "welcome"
											? "rounded-md bg-[linear-gradient(145deg,var(--primary-emphasis),var(--primary))] text-white shadow-sm hover:brightness-110"
											: "rounded-full bg-primary text-background hover:bg-primary/80",
									)}
									disabled={!canSend}
									onClick={handleSend}
									type="button"
								>
									<ArrowUp className="size-2" />
								</button>
							)}
						</div>
					</div>
				</div>
				{attachments.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{attachments.map((attachment) => (
							<span
								className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs text-foreground"
								key={attachment.id}
							>
								{attachment.isImage ? "image:" : "file:"} {attachment.name}
								<button
									aria-label={`Remove ${attachment.name}`}
									className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
									onClick={() => onRemoveAttachment(attachment.id)}
									type="button"
								>
									<X className="h-3 w-3" />
								</button>
							</span>
						))}
					</div>
				)}
			</div>

			{/* Composer settings */}
			<div className="flex min-w-0 items-center justify-between gap-x-3 gap-y-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
				<div className="flex min-w-0 flex-auto flex-wrap items-center gap-2 max-[560px]:flex-nowrap">
					<button
						aria-label="Attach files"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => fileInputRef.current?.click()}
						type="button"
					>
						<Paperclip className="h-4 w-4" />
					</button>
					<input
						accept="*/*"
						className="hidden"
						multiple
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							if (files.length > 0) onAttachFiles(files);
							event.currentTarget.value = "";
						}}
						ref={fileInputRef}
						type="file"
					/>
					<div className="hidden shrink-0 items-center rounded-md bg-muted p-0.5">
						<button
							aria-pressed={mode === "plan"}
							className={cn(
								"rounded px-2 py-1 transition-colors",
								mode === "plan"
									? "bg-background text-foreground shadow-xs"
									: "hover:text-foreground",
							)}
							onClick={() => {
								if (mode !== "plan") onModeToggle();
							}}
							type="button"
						>
							Plan
						</button>
						<button
							aria-pressed={mode === "act"}
							className={cn(
								"rounded px-2 py-1 transition-colors",
								mode === "act"
									? "bg-background text-foreground shadow-xs"
									: "hover:text-foreground",
							)}
							onClick={() => {
								if (mode !== "act") onModeToggle();
							}}
							type="button"
						>
							Act
						</button>
					</div>
					<div className="min-w-0 shrink-0">
						<ModelSelector
							isBusy={isBusy}
							model={model}
							onModelChange={onModelChange}
							onModelSupportsReasoningChange={
								handleModelSupportsReasoningChange
							}
							onProviderChange={onProviderChange}
							provider={provider}
						/>
					</div>
					<Select
						disabled={modelSupportsReasoning !== true}
						onValueChange={handleEffortChange}
						value={EFFORT_LEVELS[effortIndex]?.value ?? "low"}
					>
						<SelectTrigger
							aria-label="Thinking level"
							className="h-7 gap-1.5 border-0 bg-muted px-2 text-[11px] shadow-none data-[size=sm]:h-7 [&>svg:last-child]:hidden max-[560px]:size-7 max-[560px]:justify-center max-[560px]:p-0"
							size="sm"
							title={
								modelSupportsReasoning === false
									? "The selected model does not report reasoning support"
									: undefined
							}
						>
							<Brain className="size-3" />
							<span className="max-[560px]:sr-only">
								<SelectValue>{effortLabel}</SelectValue>
							</span>
						</SelectTrigger>
						<SelectContent align="start">
							{EFFORT_LEVELS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="ml-auto flex min-w-0 items-center gap-2 max-[560px]:shrink-0">
					{variant === "conversation" ? (
						<div className="flex min-w-0 items-center gap-0">
							<div className="min-w-0 overflow-visible">
								<WorkspaceSelector
									currentBranch={gitBranch}
									disabled
									onListGitBranches={onListGitBranches}
									onRefreshWorkspaces={onRefreshWorkspaces}
									onPickWorkspaceDirectory={onPickWorkspaceDirectory}
									onSwitchGitBranch={onSwitchGitBranch}
									onSwitchWorkspace={onSwitchWorkspace}
									workspaces={workspaces}
									workspaceRoot={workspaceRoot}
								/>
							</div>
							<TokenUsageRing
								usage={{
									contextWindow: modelContextWindow,
									tokensIn: summary.tokensIn,
									tokensOut: summary.tokensOut,
									totalCost: summary.totalCostUsd,
								}}
							/>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

// Memoized: the selectors load/hold the full provider-model catalog, so they
// should not re-render for every keystroke in the composer textarea.
const ModelSelector = memo(function ModelSelector({
	provider,
	model,
	isBusy,
	onProviderChange,
	onModelChange,
	onModelSupportsReasoningChange,
}: {
	provider: string;
	model: string;
	isBusy: boolean;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModelSupportsReasoningChange: (supportsReasoning: boolean | null) => void;
}) {
	const normalizedProvider = normalizeProviderId(provider);
	const [providerModels, setProviderModels] = useState<
		Record<string, string[]>
	>(FALLBACK_PROVIDER_MODELS);
	const [providerReasoningModels, setProviderReasoningModels] = useState<
		Record<string, string[]>
	>(FALLBACK_PROVIDER_REASONING_MODELS);
	const [reasoningCapabilitySource, setReasoningCapabilitySource] = useState<
		"loading" | "catalog" | "fallback"
	>("loading");
	const [enabledProviderIds, setEnabledProviderIds] = useState<string[]>([]);
	const [lastSelection, setLastSelection] = useState(() =>
		readModelSelectionStorageFromWindow(),
	);
	const [mobileOpen, setMobileOpen] = useState(false);
	const visibleProviderModels = useMemo(() => {
		const next: Record<string, string[]> = {};
		for (const providerId of enabledProviderIds) {
			next[providerId] = providerModels[providerId] ?? [];
		}
		return next;
	}, [enabledProviderIds, providerModels]);
	const providers = useMemo(
		() => Object.keys(visibleProviderModels),
		[visibleProviderModels],
	);
	const rememberedLastProvider = lastSelection.lastProvider.trim();
	const resolvedProvider = useMemo(() => {
		if (providers.length === 0) {
			return "";
		}
		const rememberedProvider = normalizeProviderId(rememberedLastProvider);
		if (normalizedProvider && providers.includes(normalizedProvider)) {
			return normalizedProvider;
		}
		if (rememberedProvider && providers.includes(rememberedProvider)) {
			return rememberedProvider;
		}
		return providers[0] ?? "";
	}, [normalizedProvider, providers, rememberedLastProvider]);
	const modelsForProvider = useMemo(
		() => visibleProviderModels[resolvedProvider] ?? [],
		[resolvedProvider, visibleProviderModels],
	);
	const resolvedModel = useMemo(() => {
		if (modelsForProvider.length === 0) {
			return "";
		}
		const rememberedModel =
			lastSelection.lastModelByProvider[resolvedProvider] ??
			lastSelection.lastModelByProvider[rememberedLastProvider];
		if (model && modelsForProvider.includes(model)) {
			return model;
		}
		if (rememberedModel && modelsForProvider.includes(rememberedModel)) {
			return rememberedModel;
		}
		return modelsForProvider[0] ?? "";
	}, [
		lastSelection.lastModelByProvider,
		model,
		modelsForProvider,
		rememberedLastProvider,
		resolvedProvider,
	]);

	useEffect(() => {
		let cancelled = false;
		setReasoningCapabilitySource("loading");

		async function loadCatalog() {
			try {
				const payload = await loadProviderModelCatalog();
				if (cancelled) {
					return;
				}
				setProviderModels(payload.providerModels);
				setProviderReasoningModels(payload.providerReasoningModels);
				setReasoningCapabilitySource("catalog");
				setEnabledProviderIds((current) => {
					const nextProviderIds = new Set(payload.enabledProviderIds);
					if (normalizedProvider) {
						nextProviderIds.add(normalizedProvider);
					}
					for (const providerId of current) {
						if (providerId in payload.providerModels) {
							nextProviderIds.add(providerId);
						}
					}
					return Array.from(nextProviderIds);
				});
			} catch {
				if (!cancelled) setReasoningCapabilitySource("fallback");
			}
		}

		void loadCatalog();
		return () => {
			cancelled = true;
		};
	}, [normalizedProvider]);

	useEffect(() => {
		if (!normalizedProvider) {
			return;
		}
		if ((providerModels[normalizedProvider] ?? []).length > 0) {
			return;
		}

		let cancelled = false;

		async function loadModelsForProvider() {
			try {
				const models = await loadProviderModels(normalizedProvider);
				if (cancelled || models.length === 0) {
					return;
				}
				const modelIds = models.map((entry) => entry.id);
				const reasoningModelIds = models
					.filter((entry) => entry.supportsReasoning)
					.map((entry) => entry.id);
				setProviderModels((current) => ({
					...current,
					[normalizedProvider]: modelIds,
				}));
				setProviderReasoningModels((current) => ({
					...current,
					[normalizedProvider]: reasoningModelIds,
				}));
				setReasoningCapabilitySource("catalog");
				setEnabledProviderIds((current) =>
					current.includes(normalizedProvider)
						? current
						: [...current, normalizedProvider],
				);
			} catch {
				// Keep existing values when provider-specific model loading fails.
			}
		}

		void loadModelsForProvider();
		return () => {
			cancelled = true;
		};
	}, [normalizedProvider, providerModels]);

	useEffect(() => {
		setLastSelection((prev) => {
			if (!normalizedProvider || !model) {
				return prev;
			}
			if (
				prev.lastProvider === normalizedProvider &&
				prev.lastModelByProvider[normalizedProvider] === model
			) {
				return prev;
			}
			return {
				lastProvider: normalizedProvider,
				lastModelByProvider: {
					...prev.lastModelByProvider,
					[normalizedProvider]: model,
				},
			};
		});
	}, [model, normalizedProvider]);

	useEffect(() => {
		try {
			writeModelSelectionStorageToWindow(lastSelection);
		} catch {
			// Ignore localStorage persistence failures.
		}
	}, [lastSelection]);

	useEffect(() => {
		if (providers.length === 0) {
			return;
		}
		if (resolvedProvider && resolvedProvider !== normalizedProvider) {
			onProviderChange(resolvedProvider);
		}
		if (resolvedModel && resolvedModel !== model) {
			onModelChange(resolvedModel);
		}
	}, [
		model,
		onModelChange,
		onProviderChange,
		normalizedProvider,
		providers,
		resolvedModel,
		resolvedProvider,
	]);

	useEffect(() => {
		if (reasoningCapabilitySource === "loading") {
			return;
		}
		if (
			reasoningCapabilitySource === "fallback" &&
			!(FALLBACK_PROVIDER_MODELS[normalizedProvider] ?? []).includes(model)
		) {
			onModelSupportsReasoningChange(null);
			return;
		}
		onModelSupportsReasoningChange(
			hasReasoningCapability(
				providerReasoningModels,
				normalizedProvider,
				model,
			),
		);
	}, [
		model,
		onModelSupportsReasoningChange,
		normalizedProvider,
		providerReasoningModels,
		reasoningCapabilitySource,
	]);

	const handleProviderSelect = useCallback(
		(value: string) => {
			onProviderChange(value);
			const rememberedModel = lastSelection.lastModelByProvider[value];
			const providerModelIds = visibleProviderModels[value] ?? [];
			if (
				rememberedModel &&
				providerModelIds.includes(rememberedModel) &&
				rememberedModel !== model
			) {
				onModelChange(rememberedModel);
				return;
			}
			const firstModel = providerModelIds[0];
			if (firstModel && firstModel !== model) {
				onModelChange(firstModel);
			}
		},
		[
			lastSelection.lastModelByProvider,
			model,
			onModelChange,
			onProviderChange,
			visibleProviderModels,
		],
	);
	const renderProviderSelect = (triggerClassName: string) => (
		<SearchCombobox
			ariaLabel="Provider"
			className={triggerClassName}
			disabled={isBusy || providers.length === 0}
			emptyText="No providers found."
			onValueChange={handleProviderSelect}
			options={providers.map((value) => ({ label: value, value }))}
			placeholder="Provider"
			placement="top"
			searchPlaceholder="Search providers"
			value={resolvedProvider}
		/>
	);
	const renderModelSelect = (
		triggerClassName: string,
		closeMobileMenu = false,
	) => (
		<SearchCombobox
			ariaLabel="Model"
			className={triggerClassName}
			disabled={isBusy || modelsForProvider.length === 0}
			emptyText="No models found."
			onValueChange={(value) => {
				onModelChange(value);
				if (closeMobileMenu) setMobileOpen(false);
			}}
			options={modelsForProvider.map((value) => ({ label: value, value }))}
			placeholder="Model"
			placement="top"
			searchPlaceholder="Search models"
			value={resolvedModel}
		/>
	);

	return (
		<div className="relative min-w-0 shrink-0 text-[11px]">
			<button
				aria-expanded={mobileOpen}
				aria-haspopup="dialog"
				aria-label="Model and provider"
				className="hidden size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 max-[560px]:inline-flex"
				disabled={isBusy || providers.length === 0}
				onClick={() => setMobileOpen((current) => !current)}
				title={`${resolvedProvider || "Provider"} / ${resolvedModel || "Model"}`}
				type="button"
			>
				<Cpu className="size-3.5" />
			</button>

			{mobileOpen ? (
				<>
					<button
						aria-label="Close model selector"
						className="fixed inset-0 z-40 hidden cursor-default opacity-0 max-[560px]:block"
						onClick={() => setMobileOpen(false)}
						type="button"
					/>
					<div className="absolute bottom-full left-0 z-50 mb-2 hidden w-64 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border border-border bg-popover p-3 shadow-xl max-[560px]:block">
						<div className="space-y-1">
							<div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
								Provider
							</div>
							{renderProviderSelect(
								"w-full max-w-none justify-between text-xs",
							)}
						</div>
						<div className="space-y-1">
							<div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
								Model
							</div>
							{renderModelSelect(
								"w-full max-w-none justify-between text-xs",
								true,
							)}
						</div>
					</div>
				</>
			) : null}

			<div className="flex min-w-0 items-center gap-0.5 max-[560px]:hidden">
				{renderProviderSelect("max-w-28 text-[11px]")}
				<span className="text-muted-foreground/50">/</span>
				{renderModelSelect("max-w-52 text-[11px]")}
			</div>
		</div>
	);
});

type TokenUsage = {
	tokensIn: number;
	tokensOut: number;
	totalCost?: number;
	contextWindow?: number;
};

/** Current input context relative to the selected model's context window. */
function TokenUsageRing({ usage }: { usage: TokenUsage }) {
	const contextWindow = usage.contextWindow;
	if (usage.tokensIn <= 0 || !contextWindow || contextWindow <= 0) {
		return null;
	}

	const ratio = Math.min(
		Math.max(usage.tokensIn / Math.max(contextWindow, 1), 0),
		1,
	);
	const percent = Math.round(ratio * 100);
	const cost = formatCostUsd(usage.totalCost);
	const contextUsageLabel = `${formatCompactTokens(usage.tokensIn)} / ${formatCompactTokens(contextWindow)} (${percent}%)`;
	const radius = 8.5;
	const circumference = 2 * Math.PI * radius;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					aria-label={`Context window: ${usage.tokensIn.toLocaleString()} of ${contextWindow.toLocaleString()} input tokens used (${percent}%)`}
					className="size-7 shrink-0 p-0 text-muted-foreground data-[state=open]:bg-accent"
					id="token-usage"
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<svg
						aria-hidden="true"
						className="-rotate-90 size-3.5"
						height="22"
						viewBox="0 0 22 22"
						width="22"
					>
						<circle
							className="stroke-muted-foreground/20"
							cx="11"
							cy="11"
							fill="none"
							r={radius}
							strokeWidth="4"
						/>
						<circle
							className="stroke-primary transition-[stroke-dashoffset] duration-200"
							cx="11"
							cy="11"
							fill="none"
							r={radius}
							strokeDasharray={circumference}
							strokeDashoffset={circumference * (1 - ratio)}
							strokeLinecap="round"
							strokeWidth="4"
						/>
					</svg>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-80 p-0"
				id="token-usage-panel"
				side="top"
				sideOffset={8}
			>
				<div className="px-3 py-3">
					<div className="flex items-center justify-between gap-4 text-sm">
						<span className="text-muted-foreground">Context window</span>
						<span className="font-mono text-xs text-foreground">
							{contextUsageLabel}
						</span>
					</div>
					<div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
						<div
							aria-hidden="true"
							className="h-full rounded-full bg-primary transition-[width] duration-200"
							style={{ width: `${percent}%` }}
						/>
					</div>
				</div>
				<div className="border-t border-border/70 px-3 py-2.5 text-xs">
					<div className="flex items-center justify-between gap-4">
						<span className="text-muted-foreground">Output tokens</span>
						<span className="font-mono text-foreground">
							{usage.tokensOut.toLocaleString()}
						</span>
					</div>
					{cost ? (
						<div className="mt-2 flex items-center justify-between gap-4">
							<span className="text-muted-foreground">Cost</span>
							<span className="font-mono text-foreground">{cost}</span>
						</div>
					) : null}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function formatCompactTokens(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${formatCompactUnit(value / 1_000)}k`;
	}
	return value.toLocaleString();
}

function formatCompactUnit(value: number): string {
	return value.toFixed(1).replace(/\.0$/, "");
}
