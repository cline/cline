"use client";

import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared/browser";
import { AgentPromptQueue, SearchCombobox } from "@cline/ui";
import {
	ArrowUp,
	CircleStop,
	Cpu,
	Paperclip,
	Signal,
	SignalHigh,
	SignalLow,
	SignalMedium,
	SignalZero,
	X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpeechInput } from "@/components/ai-elements/speech-input";
import type { RealtimeChatBridge } from "@/components/realtime-voice-bridge";
import { RealtimeVoiceOverlay } from "@/components/realtime-voice-overlay";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useWorkspace } from "@/contexts/workspace-context";
import type { PromptInQueue } from "@/hooks/chat-session/types";
import { formatCostUsd } from "@/hooks/use-session-history";
import { toast } from "@/hooks/use-toast";
import type { ChatSessionConfig, ChatSessionStatus } from "@/lib/chat-schema";
import { desktopClient, writeDesktopDebugLog } from "@/lib/desktop-client";
import {
	readModelSelectionStorageFromWindow,
	writeModelSelectionStorageToWindow,
} from "@/lib/model-selection";
import { normalizeProviderId } from "@/lib/provider-id";
import {
	loadProviderModelCatalog,
	loadProviderModels,
	MODE_SETTINGS_CHANGED_EVENT,
	type RealtimeVoiceModelTarget,
	subscribeToProviderModels,
	type TranscriptionModelTarget,
} from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";
import { startVercelStreamingTranscription } from "@/lib/vercel-streaming-transcription";

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

function ReasoningEffortIcon({
	value,
	className = "size-3",
}: {
	value: ReasoningEffortOption["value"];
	className?: string;
}) {
	const LevelIcon =
		value === "none"
			? SignalZero
			: value === "low"
				? SignalLow
				: value === "medium"
					? SignalMedium
					: value === "high"
						? SignalHigh
						: Signal;
	return (
		<span
			aria-hidden="true"
			className={cn("relative inline-flex -scale-x-100", className)}
		>
			<Signal className="absolute inset-0 size-full text-primary opacity-50" />
			<LevelIcon className="relative size-full text-primary" />
		</span>
	);
}
const PROMPT_INPUT_COLLAPSED_ROWS = 1;
const PROMPT_INPUT_WELCOME_ROWS = 3;
const AUDIO_BASE64_CHUNK_SIZE = 0x8000;
const MAX_RECORDED_AUDIO_BYTES = 25 * 1024 * 1024;

async function blobToBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	for (
		let offset = 0;
		offset < bytes.length;
		offset += AUDIO_BASE64_CHUNK_SIZE
	) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, offset + AUDIO_BASE64_CHUNK_SIZE),
		);
	}
	return window.btoa(binary);
}
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
	promptDraft: PromptDraft;
	onPromptInputChange: (value: string) => void;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModeToggle: () => void;
	onReasoningChange: (
		next: Pick<ChatSessionConfig, "thinking" | "reasoningEffort">,
	) => void;
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
	realtimeBridge?: RealtimeChatBridge | null;
	onOpenRealtimeVoiceSettings?: () => void;
	onOpenVoiceInputSettings?: () => void;
	summary: {
		toolCalls: number;
		tokensIn: number;
		tokensOut: number;
		cacheReadTokens?: number;
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
	promptDraft,
	onPromptInputChange,
	onProviderChange,
	onModelChange,
	onModeToggle,
	onReasoningChange,
	onSend,
	onAbort,
	promptsInQueue,
	attachments,
	onAttachFiles,
	onRemoveAttachment,
	onSteerPromptInQueue,
	onEditPromptInQueue,
	onRemovePromptInQueue,
	realtimeBridge = null,
	onOpenRealtimeVoiceSettings,
	onOpenVoiceInputSettings,
	summary,
}: ChatInputBarProps) {
	const { workspaceRoot } = useWorkspace();
	// Keystrokes only update this local state; the parent page tree is not
	// re-rendered per keypress. External writers push text in via promptDraft.
	const [promptInput, setPromptInputState] = useState(promptDraft.value);
	const promptInputValueRef = useRef(promptDraft.value);
	const appliedDraftVersionRef = useRef(promptDraft.version);
	const setPromptInput = useCallback(
		(value: string) => {
			promptInputValueRef.current = value;
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
	const streamingTranscriptRangeRef = useRef<{
		start: number;
		end: number;
	} | null>(null);
	const [transcriptionTarget, setTranscriptionTarget] =
		useState<TranscriptionModelTarget | null>(null);
	const [realtimeVoiceTarget, setRealtimeVoiceTarget] =
		useState<RealtimeVoiceModelTarget | null>(null);
	const [realtimeVoiceOpen, setRealtimeVoiceOpen] = useState(false);
	const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
	const [speechInputActive, setSpeechInputActive] = useState(false);
	const thinkingSliderRef = useRef<HTMLInputElement | null>(null);
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
	useEffect(() => {
		let cancelled = false;
		let loadId = 0;
		const loadModeSettings = () => {
			const currentLoadId = ++loadId;
			loadProviderModelCatalog()
				.then((catalog) => {
					if (!cancelled && currentLoadId === loadId) {
						setTranscriptionTarget(catalog.modes.voiceInput);
						setRealtimeVoiceTarget(catalog.modes.realtimeVoice);
					}
				})
				.catch(() => {
					if (!cancelled && currentLoadId === loadId) {
						setTranscriptionTarget(null);
						setRealtimeVoiceTarget(null);
					}
				});
		};
		const handleModeSettingsChanged = (event: Event) => {
			const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
			if (!mode || mode === "voiceInput" || mode === "realtimeVoice") {
				loadModeSettings();
			}
		};
		loadModeSettings();
		window.addEventListener(
			MODE_SETTINGS_CHANGED_EVENT,
			handleModeSettingsChanged,
		);
		return () => {
			cancelled = true;
			loadId += 1;
			window.removeEventListener(
				MODE_SETTINGS_CHANGED_EVENT,
				handleModeSettingsChanged,
			);
		};
	}, []);

	const handleTranscriptionChange = useCallback(
		(transcript: string) => {
			const text = transcript.trim();
			if (!text) return;

			const current = promptInputValueRef.current;
			const input = promptInputRef.current;
			const insertionStart = input?.selectionStart ?? current.length;
			const insertionEnd = input?.selectionEnd ?? insertionStart;
			const before = current.slice(0, insertionStart);
			const after = current.slice(insertionEnd);
			const leadingSpace = before.length > 0 && !/\s$/.test(before) ? " " : "";
			const trailingSpace = after.length > 0 && !/^\s/.test(after) ? " " : "";
			const insertedText = `${leadingSpace}${text}${trailingSpace}`;
			const next = `${before}${insertedText}${after}`;
			const nextCursor = before.length + insertedText.length;
			setPromptInput(next);
			requestAnimationFrame(() => {
				const textarea = promptInputRef.current;
				if (!textarea) return;
				textarea.focus();
				textarea.setSelectionRange(nextCursor, nextCursor);
				setCursorIndex(nextCursor);
			});
		},
		[setPromptInput],
	);

	const handleStreamingTranscriptionStart = useCallback(() => {
		const current = promptInputValueRef.current;
		const input = promptInputRef.current;
		const start = input?.selectionStart ?? current.length;
		const end = input?.selectionEnd ?? start;
		streamingTranscriptRangeRef.current = { start, end };
	}, []);

	const handleStreamingTranscriptionChange = useCallback(
		(transcript: string) => {
			const text = transcript.trim();
			const range = streamingTranscriptRangeRef.current;
			if (!text || !range) return;

			const current = promptInputValueRef.current;
			const before = current.slice(0, range.start);
			const after = current.slice(range.end);
			const leadingSpace = before.length > 0 && !/\s$/.test(before) ? " " : "";
			const trailingSpace = after.length > 0 && !/^\s/.test(after) ? " " : "";
			const insertion = `${leadingSpace}${text}${trailingSpace}`;
			const next = `${before}${insertion}${after}`;
			const nextEnd = range.start + insertion.length;
			streamingTranscriptRangeRef.current = {
				start: range.start,
				end: nextEnd,
			};
			setPromptInput(next);

			requestAnimationFrame(() => {
				const textarea = promptInputRef.current;
				textarea?.focus();
				textarea?.setSelectionRange(nextEnd, nextEnd);
				setCursorIndex(nextEnd);
			});
		},
		[setPromptInput],
	);

	const handleStreamingTranscriptionEnd = useCallback(() => {
		streamingTranscriptRangeRef.current = null;
	}, []);

	const handleStartStreamingTranscription = useCallback(
		() =>
			startVercelStreamingTranscription({
				onTranscript: handleStreamingTranscriptionChange,
			}),
		[handleStreamingTranscriptionChange],
	);

	const handleAudioRecorded = useCallback(
		async (audioBlob: Blob): Promise<string> => {
			if (!transcriptionTarget) {
				throw new Error(
					"Configure an audio-to-text provider before using speech input",
				);
			}
			if (audioBlob.size > MAX_RECORDED_AUDIO_BYTES) {
				throw new Error("Recorded audio exceeds the 25 MiB upload limit");
			}
			writeDesktopDebugLog({
				scope: "voice-input",
				level: "debug",
				message: "Webview recorded audio and is sending it to the sidecar",
				timestamp: new Date().toISOString(),
				metadata: {
					providerId: transcriptionTarget.providerId,
					modelId: transcriptionTarget.modelId,
					mediaType: audioBlob.type,
					audioBytes: audioBlob.size,
				},
			});
			const audioBase64 = await blobToBase64(audioBlob);
			const result = await desktopClient.invoke<{ text?: string }>(
				"transcribe_audio",
				{
					audioBase64,
					mediaType: audioBlob.type,
				},
			);
			const text = result.text?.trim();
			if (!text) {
				throw new Error("The transcription provider returned no text");
			}
			return text;
		},
		[transcriptionTarget],
	);

	const handleSpeechInputError = useCallback((error: unknown) => {
		const message =
			error instanceof Error
				? error.message
				: "Check microphone permission and audio provider settings.";
		writeDesktopDebugLog({
			scope: "voice-input",
			level: "error",
			message: "Speech input failed in the webview",
			timestamp: new Date().toISOString(),
			metadata: { failure: message },
		});
		toast({
			variant: "destructive",
			title: "Speech input failed",
			description: message,
		});
	}, []);

	const effortIndex = useMemo(
		() => resolveEffortIndex(thinking, reasoningEffort),
		[reasoningEffort, thinking],
	);
	const effortLabel = EFFORT_LEVELS[effortIndex]?.label ?? "Low";
	const promptInputRows =
		variant === "welcome"
			? PROMPT_INPUT_WELCOME_ROWS
			: promptInputFocused
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
				"w-full min-w-0 max-w-full bg-card",
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
								"rounded-none border-0 bg-transparent px-0 py-0 focus-within:ring-0",
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
						<div className="flex shrink-0 items-center gap-1">
							<RealtimeVoiceOverlay
								bridge={realtimeBridge}
								onConfigure={() => onOpenRealtimeVoiceSettings?.()}
								onOpenChange={setRealtimeVoiceOpen}
								open={realtimeVoiceOpen}
								target={realtimeVoiceTarget}
							/>
							{(!hasDraft || speechInputActive) && (
								<SpeechInput
									allowUnavailableClick={!transcriptionTarget}
									onActiveChange={setSpeechInputActive}
									onAudioRecorded={handleAudioRecorded}
									onClick={(event) => {
										if (!transcriptionTarget) {
											event.preventDefault();
											onOpenVoiceInputSettings?.();
										}
									}}
									onError={handleSpeechInputError}
									onStartStreaming={
										transcriptionTarget?.supportsStreaming
											? handleStartStreamingTranscription
											: undefined
									}
									onStreamingEnd={handleStreamingTranscriptionEnd}
									onStreamingStart={handleStreamingTranscriptionStart}
									onTranscriptionChange={
										transcriptionTarget?.supportsStreaming
											? undefined
											: handleTranscriptionChange
									}
									recordingMode={
										transcriptionTarget?.supportsStreaming
											? "streaming"
											: "media-recorder"
									}
									title={
										transcriptionTarget
											? `${transcriptionTarget.supportsStreaming ? "Transcribe live" : "Transcribe"} with ${transcriptionTarget.providerName} / ${transcriptionTarget.modelName}`
											: "Configure voice input in Settings → Models"
									}
								/>
							)}
							{canAbort ? (
								<button
									aria-label="Stop agent"
									className={cn(
										"inline-grid size-7 shrink-0 place-items-center p-0 text-background transition-colors hover:bg-primary/80",
										variant === "welcome"
											? "rounded-md bg-foreground"
											: "rounded-full bg-foreground",
									)}
									onClick={onAbort}
									type="button"
								>
									<CircleStop className="size-2" />
								</button>
							) : canSend ? (
								<button
									aria-label="Send message"
									className={cn(
										"inline-grid size-7 shrink-0 place-items-center p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
							) : null}
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
			<div className="flex min-w-0 items-center  justify-between gap-x-3 gap-y-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
				<div className="flex min-w-0 flex-auto flex-wrap items-center gap-2 max-[560px]:flex-nowrap">
					<button
						aria-label="Attach files"
						className="rounded-md p-0 pl-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => fileInputRef.current?.click()}
						type="button"
					>
						<Paperclip className="size-3" />
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
				</div>

				<div className="ml-auto flex min-w-0 shrink-0 items-center gap-0">
					<Popover onOpenChange={setModelSettingsOpen} open={modelSettingsOpen}>
						<PopoverTrigger asChild>
							<button
								aria-label="Model settings"
								className="flex h-7 max-w-md items-center gap-1 rounded-md px-2 text-[11px] transition-colors hover:bg-accent"
								type="button"
							>
								<span className="truncate text-muted-foreground">
									{provider}
								</span>
								<span className="truncate text-foreground">{model}</span>
								<ReasoningEffortIcon
									className="size-3 shrink-0"
									value={EFFORT_LEVELS[effortIndex]?.value ?? "low"}
								/>
							</button>
						</PopoverTrigger>
						<PopoverContent
							align="end"
							className="w-72 space-y-1 p-2"
							onOpenAutoFocus={(event) => {
								event.preventDefault();
								requestAnimationFrame(() => thinkingSliderRef.current?.focus());
							}}
							side="top"
						>
							<ModelSelector
								isBusy={isBusy}
								model={model}
								onModelChange={onModelChange}
								onModelSupportsReasoningChange={
									handleModelSupportsReasoningChange
								}
								onProviderChange={onProviderChange}
								provider={provider}
								variant="menu"
							/>
							<div className="rounded-md p-1 px-2">
								<div className="flex items-center justify-between text-xs">
									<div className="mb-0.5 text-[10px] text-muted-foreground">
										Effort
									</div>
									<span className="flex items-center gap-1.5 text-foreground text-[10px]">
										{effortLabel}
										<ReasoningEffortIcon
											className="size-3.5"
											value={EFFORT_LEVELS[effortIndex]?.value ?? "low"}
										/>
									</span>
								</div>
								<div className="relative mt-3 h-4">
									<input
										aria-label="Effort"
										aria-valuetext={effortLabel}
										className="relative z-10 block h-4 w-full cursor-pointer appearance-none rounded-full transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150 [&::-webkit-slider-thumb]:ease-out active:[&::-webkit-slider-thumb]:scale-110"
										disabled={modelSupportsReasoning !== true}
										max={EFFORT_LEVELS.length - 1}
										min={0}
										onChange={(event) => {
											const option =
												EFFORT_LEVELS[Number(event.currentTarget.value)];
											if (option) handleEffortChange(option.value);
										}}
										onKeyDown={(event) => {
											if (
												event.key !== "ArrowLeft" &&
												event.key !== "ArrowRight"
											) {
												return;
											}
											event.preventDefault();
											const direction = event.key === "ArrowRight" ? 1 : -1;
											const nextIndex = Math.min(
												EFFORT_LEVELS.length - 1,
												Math.max(0, effortIndex + direction),
											);
											const option = EFFORT_LEVELS[nextIndex];
											if (option) handleEffortChange(option.value);
										}}
										step={1}
										ref={thinkingSliderRef}
										style={{
											background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${(effortIndex / (EFFORT_LEVELS.length - 1)) * 100}%, var(--muted) ${(effortIndex / (EFFORT_LEVELS.length - 1)) * 100}%, var(--muted) 100%)`,
										}}
										type="range"
										value={effortIndex}
									/>
									{effortIndex === EFFORT_LEVELS.length - 1 ? (
										<div
											aria-hidden="true"
											className="cline-thinking-slider-shimmer pointer-events-none absolute inset-0 z-20 rounded-full"
											data-slot="extra-thinking-animation"
										/>
									) : null}
									<div
										aria-hidden="true"
										className="pointer-events-none absolute left-2.5 right-2.5 top-0 z-20 flex h-4 items-center justify-between"
										data-slot="thinking-level-markers"
									>
										{EFFORT_LEVELS.map((option) => (
											<span
												className="size-1 rounded-full bg-zinc-500 opacity-50"
												key={option.value}
											/>
										))}
									</div>
								</div>
							</div>
						</PopoverContent>
					</Popover>
					{variant === "conversation" ? (
						<TokenUsageRing
							usage={{
								contextWindow: modelContextWindow,
								tokensIn: summary.tokensIn,
								tokensOut: summary.tokensOut,
								cacheReadTokens: summary.cacheReadTokens ?? 0,
								totalCost: summary.totalCostUsd,
							}}
						/>
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
	variant = "toolbar",
}: {
	provider: string;
	model: string;
	isBusy: boolean;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModelSupportsReasoningChange: (supportsReasoning: boolean | null) => void;
	variant?: "toolbar" | "menu";
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

		async function loadCatalogAndActiveModels() {
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

			if (!normalizedProvider || cancelled) {
				return;
			}
			try {
				const models = await loadProviderModels(normalizedProvider);
				if (cancelled || models.length === 0) {
					return;
				}
				setProviderModels((current) => ({
					...current,
					[normalizedProvider]: models.map((entry) => entry.id),
				}));
				setProviderReasoningModels((current) => ({
					...current,
					[normalizedProvider]: models
						.filter((entry) => entry.supportsReasoning)
						.map((entry) => entry.id),
				}));
				setReasoningCapabilitySource("catalog");
				setEnabledProviderIds((current) =>
					current.includes(normalizedProvider)
						? current
						: [...current, normalizedProvider],
				);
			} catch {
				// Keep the catalog values when provider-specific loading fails.
			}
		}

		void loadCatalogAndActiveModels();
		return () => {
			cancelled = true;
		};
	}, [normalizedProvider]);

	useEffect(() => {
		return subscribeToProviderModels((providerId, models) => {
			const normalizedId = normalizeProviderId(providerId);
			setProviderModels((current) => ({
				...current,
				[normalizedId]: models.map((entry) => entry.id),
			}));
			setProviderReasoningModels((current) => ({
				...current,
				[normalizedId]: models
					.filter((entry) => entry.supportsReasoning)
					.map((entry) => entry.id),
			}));
			setEnabledProviderIds((current) =>
				current.includes(normalizedId) ? current : [...current, normalizedId],
			);
		});
	}, []);

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
	const renderProviderSelect = (
		triggerClassName: string,
		placement: "top" | "right" | "bottom" | "left" = "top",
	) => (
		<SearchCombobox
			ariaLabel="Provider"
			className={triggerClassName}
			disabled={isBusy || providers.length === 0}
			emptyText="No providers found."
			onValueChange={handleProviderSelect}
			options={providers.map((value) => ({ label: value, value }))}
			placeholder="Provider"
			placement={placement}
			searchPlaceholder="Search providers"
			value={resolvedProvider}
		/>
	);
	const renderModelSelect = (
		triggerClassName: string,
		closeMobileMenu = false,
		placement: "top" | "right" | "bottom" | "left" = "top",
		align: "start" | "end" = "start",
	) => (
		<SearchCombobox
			align={align}
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
			placement={placement}
			searchPlaceholder="Search models"
			value={resolvedModel}
		/>
	);
	if (variant === "menu") {
		return (
			<div className="grid gap-1 text-xs">
				<div
					className="rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
					data-slot="provider-selector-row"
				>
					<div className="mb-0.5 text-[10px] text-muted-foreground">
						Provider
					</div>
					{renderProviderSelect(
						"h-6 w-full max-w-none justify-start border-0 bg-transparent !p-0 text-left text-xs text-foreground shadow-none hover:bg-transparent",
						"left",
					)}
				</div>
				<div
					className="rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
					data-slot="model-selector-row"
				>
					<div className="mb-0.5 text-[10px] text-muted-foreground">Model</div>
					{renderModelSelect(
						"h-6 w-full max-w-none justify-start border-0 bg-transparent !p-0 text-left text-xs text-foreground shadow-none hover:bg-transparent",
						false,
						"left",
						"start",
					)}
				</div>
			</div>
		);
	}

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

			<div className="flex min-w-0 items-center gap-0 max-[560px]:hidden">
				{renderProviderSelect("max-w-28 text-[11px] text-muted-foreground")}
				{renderModelSelect("max-w-52 text-[11px] text-foreground")}
			</div>
		</div>
	);
});

type TokenUsage = {
	tokensIn: number;
	tokensOut: number;
	cacheReadTokens: number;
	totalCost?: number;
	contextWindow?: number;
};

/** Current model context relative to the selected model's context window. */
function TokenUsageRing({ usage }: { usage: TokenUsage }) {
	const contextWindow = usage.contextWindow;
	const totalTokens = usage.tokensIn + usage.tokensOut;
	if (totalTokens <= 0 || !contextWindow || contextWindow <= 0) {
		return null;
	}

	const ratio = Math.min(
		Math.max(totalTokens / Math.max(contextWindow, 1), 0),
		1,
	);
	const percent = Math.round(ratio * 100);
	const ringColorClass =
		ratio >= 0.75
			? "stroke-red-500"
			: ratio >= 0.5
				? "stroke-orange-500"
				: "stroke-primary";
	const cost = formatCostUsd(usage.totalCost);
	const contextUsageLabel = `${formatCompactTokens(totalTokens)} / ${formatCompactTokens(contextWindow)} (${percent}%)`;
	const cachedTokens = Math.min(usage.cacheReadTokens, usage.tokensIn);
	const uncachedInputTokens = Math.max(usage.tokensIn - cachedTokens, 0);
	const segmentScale =
		totalTokens > contextWindow ? contextWindow / totalTokens : 1;
	const segmentWidth = (tokens: number) =>
		`${(tokens / contextWindow) * segmentScale * 100}%`;
	const radius = 8.5;
	const circumference = 2 * Math.PI * radius;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					aria-label={`Context window: ${totalTokens.toLocaleString()} of ${contextWindow.toLocaleString()} tokens used (${percent}%)`}
					className="size-7 shrink-0 p-0 text-muted-foreground data-[state=open]:bg-accent opacity-65 hover:opacity-100"
					id="token-usage"
					size="icon-sm"
					type="button"
					variant="text"
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
							className={cn(
								"transition-[stroke,stroke-dashoffset] duration-200",
								ringColorClass,
							)}
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
					<div className="mt-2 flex h-1 overflow-hidden rounded-full bg-muted">
						<div
							aria-hidden="true"
							className="h-full shrink-0 bg-primary transition-[width] duration-200"
							data-token-kind="uncached-input"
							style={{ width: segmentWidth(uncachedInputTokens) }}
						/>
						<div
							aria-hidden="true"
							className="h-full shrink-0 bg-primary/60 transition-[background,width] duration-200"
							data-token-kind="cached-input"
							style={{
								backgroundImage:
									"linear-gradient(to right, var(--primary), color-mix(in srgb, var(--primary) 60%, transparent))",
								width: segmentWidth(cachedTokens),
							}}
						/>
						<div
							aria-hidden="true"
							className="h-full shrink-0 bg-blue-500 transition-[background,width] duration-200"
							data-token-kind="output"
							style={{
								backgroundImage:
									"linear-gradient(to right, color-mix(in srgb, var(--primary) 60%, transparent), var(--color-blue-500))",
								width: segmentWidth(usage.tokensOut),
							}}
						/>
					</div>
					<div className="mt-3 space-y-2 text-xs">
						<div className="flex items-center justify-between gap-4">
							<span className="text-muted-foreground">Input tokens</span>
							<span className="font-mono text-foreground">
								{usage.tokensIn.toLocaleString()}
							</span>
						</div>
						<div className="flex items-center justify-between gap-4">
							<span className="text-muted-foreground">Output tokens</span>
							<span className="font-mono text-foreground">
								{usage.tokensOut.toLocaleString()}
							</span>
						</div>
						<div className="flex items-center justify-between gap-4">
							<span className="text-muted-foreground">Cached tokens</span>
							<span className="font-mono text-foreground">
								{usage.cacheReadTokens.toLocaleString()}
							</span>
						</div>
						{cost ? (
							<div className="flex items-center justify-between gap-4">
								<span className="text-muted-foreground">Cost</span>
								<span className="font-mono text-foreground">{cost}</span>
							</div>
						) : null}
					</div>
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
