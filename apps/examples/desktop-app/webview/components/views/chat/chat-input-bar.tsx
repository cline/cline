"use client";

import {
	ArrowUp,
	Brain,
	Check,
	ChevronDown,
	CircleStop,
	Coins,
	Paperclip,
	Pencil,
	Undo2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@/components/ui/combobox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/contexts/workspace-context";
import type { PromptInQueue } from "@/hooks/chat-session/types";
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
import { WorkspaceSelector } from "./workspace-selector";

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
	cline: ["anthropic/claude-sonnet-4.6"],
	anthropic: ["claude-sonnet-4-6"],
	"openai-native": ["gpt-5.5"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-3-pro-latest"],
};

const FALLBACK_PROVIDER_REASONING_MODELS: Record<string, string[]> = {
	cline: ["anthropic/claude-sonnet-4.6"],
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
const PROMPT_INPUT_FOCUSED_ROWS = 5;

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

type ChatInputBarProps = {
	variant?: "conversation" | "welcome";
	status: ChatSessionStatus;
	provider: string;
	model: string;
	mode: "act" | "plan";
	thinking: ChatSessionConfig["thinking"];
	reasoningEffort: ChatSessionConfig["reasoningEffort"];
	gitBranch: string;
	promptInput: string;
	onPromptInputChange: (value: string) => void;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModeToggle: () => void;
	onReasoningChange: (
		next: Pick<ChatSessionConfig, "thinking" | "reasoningEffort">,
	) => void;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
	onSend: () => void;
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
	onUndoPromptInQueue: (item: PromptInQueue) => Promise<void> | void;
	summary: {
		toolCalls: number;
		tokensIn: number;
		tokensOut: number;
	};
};

export function ChatInputBar({
	variant = "conversation",
	status,
	provider,
	model,
	mode,
	thinking,
	reasoningEffort,
	gitBranch,
	promptInput,
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
	onUndoPromptInQueue,
	summary,
}: ChatInputBarProps) {
	const {
		workspaceRoot,
		workspaces,
		refreshWorkspaces: onRefreshWorkspaces,
		switchWorkspace: onSwitchWorkspace,
		pickWorkspaceDirectory: onPickWorkspaceDirectory,
	} = useWorkspace();
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
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
	const [promptInputFocused, setPromptInputFocused] = useState(false);
	const [cursorIndex, setCursorIndex] = useState(() => promptInput.length);
	const [mentionOpen, setMentionOpen] = useState(false);
	const [activeMention, setActiveMention] = useState<ActiveMention | null>(
		null,
	);
	const [mentionFiles, setMentionFiles] = useState<string[]>([]);
	const [mentionLoading, setMentionLoading] = useState(false);
	const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
	const mentionResultsCacheRef = useRef(new Map<string, string[]>());
	const mentionLastRequestKeyRef = useRef<string | null>(null);

	// ---- Slash command state ----
	const [slashOpen, setSlashOpen] = useState(false);
	const [activeSlash, setActiveSlash] = useState<ActiveSlash | null>(null);
	const [slashCommands, setSlashCommands] = useState<SlashCommand[]>(
		BUILTIN_SLASH_COMMANDS,
	);
	const [slashLoading, setSlashLoading] = useState(false);
	const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
	const slashCommandsLoadedRef = useRef(false);
	const [editingQueuedPromptId, setEditingQueuedPromptId] = useState<
		string | null
	>(null);
	const [editingQueuedPromptValue, setEditingQueuedPromptValue] = useState("");
	const [queueActionPendingId, setQueueActionPendingId] = useState<
		string | null
	>(null);

	const tokensSummary = useMemo(() => {
		const total = summary.tokensIn + summary.tokensOut;
		if (total === 0) {
			return undefined;
		}
		return `${total.toLocaleString()} tokens`;
	}, [summary.tokensIn, summary.tokensOut]);
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

	const startQueuedPromptEdit = useCallback((item: PromptInQueue) => {
		setEditingQueuedPromptId(item.id);
		setEditingQueuedPromptValue(item.prompt);
	}, []);

	const cancelQueuedPromptEdit = useCallback(() => {
		setEditingQueuedPromptId(null);
		setEditingQueuedPromptValue("");
	}, []);

	const submitQueuedPromptEdit = useCallback(
		async (item: PromptInQueue) => {
			const nextPrompt = editingQueuedPromptValue.trim();
			if (!nextPrompt || queueActionPendingId) {
				return;
			}
			setQueueActionPendingId(item.id);
			try {
				await onEditPromptInQueue(item.id, nextPrompt);
				cancelQueuedPromptEdit();
			} finally {
				setQueueActionPendingId(null);
			}
		},
		[
			cancelQueuedPromptEdit,
			editingQueuedPromptValue,
			onEditPromptInQueue,
			queueActionPendingId,
		],
	);

	const triggerQueuedPromptAction = useCallback(
		async (item: PromptInQueue, action: "steer" | "undo") => {
			if (queueActionPendingId) {
				return;
			}
			setQueueActionPendingId(item.id);
			try {
				if (action === "steer") {
					await onSteerPromptInQueue(item.id);
				} else {
					await onUndoPromptInQueue(item);
				}
			} finally {
				setQueueActionPendingId(null);
			}
		},
		[onSteerPromptInQueue, onUndoPromptInQueue, queueActionPendingId],
	);

	useEffect(() => {
		setCursorIndex((prev) => Math.min(prev, promptInput.length));
	}, [promptInput.length]);

	useEffect(() => {
		if (
			editingQueuedPromptId &&
			!promptsInQueue.some((item) => item.id === editingQueuedPromptId)
		) {
			cancelQueuedPromptEdit();
		}
	}, [cancelQueuedPromptEdit, editingQueuedPromptId, promptsInQueue]);

	useEffect(() => {
		const nextMention = getActiveMention(promptInput, cursorIndex);
		setActiveMention(nextMention);
		setMentionOpen(nextMention !== null);
	}, [promptInput, cursorIndex]);

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
			onPromptInputChange(nextValue);
			setMentionOpen(false);
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
		[activeMention, onPromptInputChange, promptInput],
	);

	// ---- Slash command effects ----

	// Detect slash mode from current input + cursor position.
	useEffect(() => {
		const nextSlash = getActiveSlash(promptInput, cursorIndex);
		setActiveSlash(nextSlash);
		setSlashOpen(nextSlash !== null);
	}, [promptInput, cursorIndex]);

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
			onPromptInputChange(nextValue);
			setSlashOpen(false);
			const nextCursor = activeSlash.slashIndex + commandName.length + 2;
			requestAnimationFrame(() => {
				const input = promptInputRef.current;
				if (!input) return;
				input.focus();
				input.setSelectionRange(nextCursor, nextCursor);
				setCursorIndex(nextCursor);
			});
		},
		[activeSlash, onPromptInputChange, promptInput],
	);

	return (
		<div
			className={cn(
				"bg-card",
				variant === "welcome"
					? "overflow-visible rounded-xl border border-border/90 bg-card/90 shadow-[0_24px_80px_-56px_color-mix(in_oklab,var(--cline-violet)_72%,transparent)] backdrop-blur-md"
					: "border-t border-border bg-card/95 backdrop-blur-sm",
			)}
		>
			{/* Input area */}
			<div className={cn("px-4 py-3", variant === "welcome" && "pb-2 pt-4")}>
				{promptsInQueue.length > 0 && (
					<div className="mb-3 rounded-lg border border-border bg-background/70 p-2">
						<div className="mb-2 flex items-center justify-between gap-2">
							<div className="text-[11px] font-medium text-foreground">
								Queued for upcoming turns
							</div>
							<div className="text-[10px] text-muted-foreground">
								Steer runs first on the next turn
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							{promptsInQueue.map((item, index) => {
								const isEditing = editingQueuedPromptId === item.id;
								const isPending = queueActionPendingId === item.id;
								const hasAttachments = (item.attachmentCount ?? 0) > 0;
								return (
									<div
										className={cn(
											"flex items-start justify-between gap-3 rounded-md border px-2.5 py-2",
											item.steer
												? "border-amber-300/60 bg-amber-500/8"
												: "border-border/70 bg-muted/30",
										)}
										key={item.id}
									>
										<div className="min-w-0 flex-1">
											<div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
												<span>
													{item.steer ? "Steer" : `Queue ${index + 1}`}
												</span>
												{item.steer ? (
													<span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
														Next turn
													</span>
												) : null}
												{hasAttachments ? (
													<span>
														{item.attachmentCount} attachment
														{item.attachmentCount === 1 ? "" : "s"}
													</span>
												) : null}
											</div>
											{isEditing ? (
												<textarea
													className="min-h-16 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-4 text-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
													disabled={isPending}
													onChange={(event) =>
														setEditingQueuedPromptValue(event.target.value)
													}
													onKeyDown={(event) => {
														if (event.key === "Escape") {
															event.preventDefault();
															cancelQueuedPromptEdit();
														}
														if (event.key === "Enter" && !event.shiftKey) {
															event.preventDefault();
															void submitQueuedPromptEdit(item);
														}
													}}
													rows={3}
													value={editingQueuedPromptValue}
												/>
											) : (
												<div className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-foreground">
													{item.prompt}
												</div>
											)}
										</div>
										<div className="flex shrink-0 items-center gap-1">
											{isEditing ? (
												<>
													<button
														className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
														disabled={
															isPending ||
															editingQueuedPromptValue.trim().length === 0
														}
														onClick={() => void submitQueuedPromptEdit(item)}
														type="button"
													>
														<Check className="h-3 w-3" />
														Save
													</button>
													<button
														className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
														disabled={isPending}
														onClick={cancelQueuedPromptEdit}
														type="button"
													>
														<X className="h-3 w-3" />
														Cancel
													</button>
												</>
											) : (
												<>
													{!item.steer ? (
														<button
															className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
															disabled={isPending}
															onClick={() =>
																void triggerQueuedPromptAction(item, "steer")
															}
															type="button"
														>
															Steer
														</button>
													) : (
														<div className="px-1 text-[10px] text-amber-700">
															Steering
														</div>
													)}
													<button
														className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
														disabled={isPending}
														onClick={() => startQueuedPromptEdit(item)}
														type="button"
													>
														<Pencil className="h-3 w-3" />
														Edit
													</button>
													<button
														className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
														disabled={isPending}
														onClick={() =>
															void triggerQueuedPromptAction(item, "undo")
														}
														type="button"
													>
														<Undo2 className="h-3 w-3" />
														Undo
													</button>
												</>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}
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
								"min-h-16 items-start rounded-none border-0 bg-transparent px-0 py-0 focus-within:ring-0",
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
							className="max-h-60 min-h-5 flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-5 text-foreground placeholder:text-muted-foreground outline-none"
							onChange={(e) => {
								onPromptInputChange(e.target.value);
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
									setSlashOpen(false);
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
									setMentionOpen(false);
									return;
								}
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									if (canSend) {
										onSend();
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
							rows={
								variant === "welcome"
									? 2
									: promptInputFocused
										? PROMPT_INPUT_FOCUSED_ROWS
										: PROMPT_INPUT_COLLAPSED_ROWS
							}
							value={promptInput}
						/>
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

			{/* Composer settings and submit */}
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground max-[560px]:grid max-[560px]:grid-cols-[auto_auto_minmax(0,1fr)_auto] max-[560px]:items-center">
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-[560px]:contents">
					<button
						aria-label="Attach files"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-[560px]:col-start-1 max-[560px]:row-start-1"
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
					<div className="flex shrink-0 items-center rounded-md bg-muted p-0.5 max-[560px]:col-start-2 max-[560px]:row-start-1">
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
					<div className="min-w-0 shrink-0 max-[560px]:col-start-3 max-[560px]:col-end-5 max-[560px]:row-start-1">
						<ModelSelector
							isBusy={isBusy}
							model={model}
							onModelChange={onModelChange}
							onModelSupportsReasoningChange={
								handleModelSupportsReasoningChange
							}
							onProviderChange={onProviderChange}
							provider={provider}
							variant={variant}
						/>
					</div>
					<Select
						disabled={modelSupportsReasoning !== true}
						onValueChange={handleEffortChange}
						value={EFFORT_LEVELS[effortIndex]?.value ?? "low"}
					>
						<SelectTrigger
							aria-label="Thinking level"
							className="h-7 min-w-[5.75rem] gap-1.5 border-0 bg-muted px-2 text-[11px] shadow-none data-[size=sm]:h-7 max-[560px]:col-span-2 max-[560px]:col-start-1 max-[560px]:row-start-2"
							size="sm"
							title={
								modelSupportsReasoning === false
									? "The selected model does not report reasoning support"
									: undefined
							}
						>
							<Brain className="size-3" />
							<SelectValue>{effortLabel}</SelectValue>
						</SelectTrigger>
						<SelectContent align="start">
							{EFFORT_LEVELS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{tokensSummary ? (
						<span className="max-[900px]:hidden">
							<StatusItem
								icon={Coins}
								label={tokensSummary}
								hasOption={false}
							/>
						</span>
					) : null}
				</div>

				<div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 max-[560px]:contents">
					<div className="max-w-48 overflow-visible max-[720px]:max-w-36 max-[560px]:col-start-3 max-[560px]:row-start-2">
						<WorkspaceSelector
							currentBranch={gitBranch}
							onListGitBranches={onListGitBranches}
							onRefreshWorkspaces={onRefreshWorkspaces}
							onPickWorkspaceDirectory={onPickWorkspaceDirectory}
							onSwitchGitBranch={onSwitchGitBranch}
							onSwitchWorkspace={onSwitchWorkspace}
							workspaces={workspaces}
							workspaceRoot={workspaceRoot}
						/>
					</div>
					<div className="flex shrink-0 items-center gap-2 max-[560px]:col-start-4 max-[560px]:row-start-2">
						{canAbort && (
							<button
								aria-label="Stop agent"
								className={cn(
									"bg-foreground p-1.5 text-background transition-colors hover:bg-foreground/80",
									variant === "welcome" ? "rounded-md" : "rounded-full",
								)}
								onClick={onAbort}
								type="button"
							>
								<CircleStop className="h-4 w-4" />
							</button>
						)}
						{(!isBusy || canSend) && (
							<button
								aria-label="Send message"
								className={cn(
									"p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
									variant === "welcome"
										? "rounded-md bg-[linear-gradient(145deg,var(--cline-violet-strong),var(--cline-violet))] text-white shadow-sm hover:brightness-110"
										: "rounded-full bg-foreground text-background hover:bg-foreground/80",
								)}
								disabled={!canSend}
								onClick={onSend}
								type="button"
							>
								<ArrowUp className="h-4 w-4" />
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function ModelSelector({
	provider,
	model,
	isBusy,
	variant,
	onProviderChange,
	onModelChange,
	onModelSupportsReasoningChange,
}: {
	provider: string;
	model: string;
	isBusy: boolean;
	variant: "conversation" | "welcome";
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

	return (
		<div className="flex min-w-0 shrink-0 items-center gap-1 text-[11px]">
			<Combobox
				items={providers}
				onValueChange={(value) => {
					if (!value) {
						return;
					}
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
				}}
				value={resolvedProvider}
			>
				<ComboboxInput
					aria-label="Provider"
					className={cn(
						"h-7 text-[11px] max-[560px]:w-20",
						variant === "welcome" && "w-24 border-0 bg-transparent shadow-none",
					)}
					disabled={isBusy || providers.length === 0}
					readOnly
					showClear={false}
					showTrigger
				/>
				<ComboboxContent>
					<ComboboxEmpty>No providers found.</ComboboxEmpty>
					<ComboboxList>
						{(item) => (
							<ComboboxItem className="text-[11px]" key={item} value={item}>
								{item}
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>

			<Combobox
				items={modelsForProvider}
				onValueChange={(value) => {
					if (!value) {
						return;
					}
					onModelChange(value);
				}}
				value={resolvedModel}
			>
				<ComboboxInput
					aria-label="Model"
					className={cn(
						"h-7 text-[11px] max-[560px]:w-32",
						variant === "welcome" && "w-52 border-0 bg-transparent shadow-none",
					)}
					disabled={isBusy || modelsForProvider.length === 0}
					readOnly
					showClear={false}
					showTrigger
				/>
				<ComboboxContent>
					<ComboboxEmpty>No models found.</ComboboxEmpty>
					<ComboboxList>
						{(item) => (
							<ComboboxItem className="text-[11px]" key={item} value={item}>
								{item}
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
		</div>
	);
}

function StatusItem({
	icon: Icon,
	label,
	onClick,
	disabled,
	hasOption = true,
}: {
	icon?: React.ComponentType<{ className?: string }>;
	label: string;
	onClick?: () => void;
	disabled?: boolean;
	hasOption?: boolean;
}) {
	const content = (
		<>
			{Icon ? <Icon className="h-3 w-3" /> : null}
			<span className="max-[560px]:sr-only">{label}</span>
			{hasOption ? <ChevronDown className="h-2.5 w-2.5" /> : null}
		</>
	);
	if (!onClick) {
		return <span className="flex items-center gap-1">{content}</span>;
	}
	return (
		<button
			className={cn(
				"flex items-center gap-1 transition-colors",
				disabled ? "cursor-not-allowed opacity-60" : "hover:text-foreground",
			)}
			disabled={disabled}
			onClick={onClick}
			type="button"
		>
			{content}
		</button>
	);
}
