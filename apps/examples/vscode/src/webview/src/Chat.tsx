"use client";

import { GitBranchIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { nanoid } from "nanoid";
import {
	type MutableRefObject,
	type ReactElement,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Checkpoint,
	CheckpointIcon,
	CheckpointTrigger,
} from "@/components/ai-elements/checkpoint";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolOutput,
} from "@/components/ai-elements/tool";
import TeamTasks, { type TeamToolEvent } from "@/components/TeamTasks";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
	WebviewChatAttachments,
	WebviewChatMessage,
	WebviewChatMessageBlock,
	WebviewDefaults,
	WebviewOutboundMessage,
	WebviewProviderModel,
	WebviewSessionSummary,
	WebviewToolEvent,
} from "../../webview-protocol";
import { Composer } from "./components/Composer";
import { getVsCodeApi, postToHost } from "./vscode";

type ChatMessage = WebviewChatMessage;
type ChatMessageBlock = WebviewChatMessageBlock;
type ToolEvent = NonNullable<WebviewChatMessage["toolEvents"]>[number];
type ProviderOption = Extract<
	WebviewOutboundMessage,
	{ type: "providers" }
>["providers"][number];
type ModelSelectionStorage = {
	lastProvider: string;
	lastModelByProvider: Record<string, string>;
};

const EMPTY_SELECTION: ModelSelectionStorage = {
	lastProvider: "",
	lastModelByProvider: {},
};

function readModelSelection(): ModelSelectionStorage {
	try {
		const state = getVsCodeApi()?.getState() as
			| { modelSelection?: ModelSelectionStorage }
			| undefined;
		if (state?.modelSelection) {
			return state.modelSelection;
		}
	} catch {
		// ignore persisted state issues in the webview
	}
	return EMPTY_SELECTION;
}

function writeModelSelection(selection: ModelSelectionStorage): void {
	try {
		const api = getVsCodeApi();
		if (!api) {
			return;
		}
		const state = (api.getState() as Record<string, unknown>) ?? {};
		api.setState({ ...state, modelSelection: selection });
	} catch {
		// ignore persisted state issues in the webview
	}
}

function parseMaxIterations(value: string): number | undefined {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createMessage(
	role: ChatMessage["role"],
	text: string,
	extra?: Partial<ChatMessage>,
): ChatMessage {
	return {
		id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
		role,
		text,
		...extra,
	};
}

function buildUserMessageLabel(
	prompt: string,
	attachments?: WebviewChatAttachments,
	attachmentCount = 0,
): string {
	const resolvedCount =
		attachmentCount || (attachments?.userImages?.length ?? 0);
	if (resolvedCount === 0) {
		return prompt;
	}
	return `${prompt}${prompt.length > 0 ? "\n\n" : ""}[attached ${resolvedCount} file${resolvedCount === 1 ? "" : "s"}]`;
}

function appendAssistantDelta(
	current: ChatMessage[],
	text: string,
	activeAssistantIdRef: MutableRefObject<string | undefined>,
): ChatMessage[] {
	if (!text) {
		return current;
	}

	const activeAssistantId = activeAssistantIdRef.current;
	if (activeAssistantId) {
		const targetIndex = current.findIndex(
			(message) => message.id === activeAssistantId,
		);
		if (targetIndex >= 0) {
			return current.map((message, index) =>
				index === targetIndex
					? {
							...message,
							text: `${message.text}${text}`,
							blocks: appendTextBlock(message.blocks, text),
						}
					: message,
			);
		}
	}

	const lastMessage = current.at(-1);
	if (lastMessage?.role === "assistant") {
		activeAssistantIdRef.current = lastMessage.id;
		return [
			...current.slice(0, -1),
			{
				...lastMessage,
				text: `${lastMessage.text}${text}`,
				blocks: appendTextBlock(lastMessage.blocks, text),
			},
		];
	}

	const assistantMessage = createMessage("assistant", text, {
		blocks: [{ id: nanoid(), type: "text", text }],
	});
	activeAssistantIdRef.current = assistantMessage.id;
	return [...current, assistantMessage];
}

function appendTextBlock(
	blocks: ChatMessageBlock[] | undefined,
	text: string,
): ChatMessageBlock[] {
	const current = blocks ?? [];
	const last = current.at(-1);
	if (last?.type === "text") {
		return current.map((block, index) =>
			index === current.length - 1 && block.type === "text"
				? { ...block, text: `${block.text}${text}` }
				: block,
		);
	}
	return [...current, { id: nanoid(), type: "text", text }];
}

function appendReasoningBlock(
	blocks: ChatMessageBlock[] | undefined,
	text: string,
	redacted?: boolean,
): ChatMessageBlock[] {
	const current = blocks ?? [];
	const last = current.at(-1);
	if (last?.type === "reasoning") {
		return current.map((block, index) =>
			index === current.length - 1 && block.type === "reasoning"
				? {
						...block,
						text: `${block.text}${text}`,
						redacted: block.redacted || redacted,
					}
				: block,
		);
	}
	return [...current, { id: nanoid(), type: "reasoning", text, redacted }];
}

function upsertToolBlock(
	blocks: ChatMessageBlock[] | undefined,
	toolEvent: ToolEvent,
): ChatMessageBlock[] {
	const current = blocks ?? [];
	const existingIndex = current.findIndex(
		(block) =>
			block.type === "tool" &&
			((block.toolEvent.toolCallId &&
				toolEvent.toolCallId &&
				block.toolEvent.toolCallId === toolEvent.toolCallId) ||
				(!block.toolEvent.toolCallId &&
					!toolEvent.toolCallId &&
					block.toolEvent.name === toolEvent.name &&
					block.toolEvent.state === "input-available" &&
					toolEvent.state !== "input-available")),
	);
	if (existingIndex === -1) {
		return [...current, { id: nanoid(), type: "tool", toolEvent }];
	}
	return current.map((block, index) =>
		index === existingIndex && block.type === "tool"
			? { ...block, toolEvent: { ...block.toolEvent, ...toolEvent } }
			: block,
	);
}

function appendReasoningDelta(
	current: ChatMessage[],
	text: string,
	redacted: boolean | undefined,
	activeAssistantIdRef: MutableRefObject<string | undefined>,
): ChatMessage[] {
	const reasoningChunk = text || (redacted ? "[redacted]" : "");
	if (!reasoningChunk) {
		return current;
	}

	const activeAssistantId = activeAssistantIdRef.current;
	if (activeAssistantId) {
		const targetIndex = current.findIndex(
			(message) => message.id === activeAssistantId,
		);
		if (targetIndex >= 0) {
			return current.map((message, index) =>
				index === targetIndex
					? {
							...message,
							reasoning: `${message.reasoning ?? ""}${reasoningChunk}`,
							reasoningRedacted: message.reasoningRedacted || redacted,
							blocks: appendReasoningBlock(
								message.blocks,
								reasoningChunk,
								redacted,
							),
						}
					: message,
			);
		}
	}

	const lastMessage = current.at(-1);
	if (lastMessage?.role === "assistant") {
		activeAssistantIdRef.current = lastMessage.id;
		return [
			...current.slice(0, -1),
			{
				...lastMessage,
				reasoning: `${lastMessage.reasoning ?? ""}${reasoningChunk}`,
				reasoningRedacted: lastMessage.reasoningRedacted || redacted,
				blocks: appendReasoningBlock(
					lastMessage.blocks,
					reasoningChunk,
					redacted,
				),
			},
		];
	}

	const assistantMessage = createMessage("assistant", "", {
		reasoning: reasoningChunk,
		reasoningRedacted: redacted,
		blocks: [
			{ id: nanoid(), type: "reasoning", text: reasoningChunk, redacted },
		],
	});
	activeAssistantIdRef.current = assistantMessage.id;
	return [...current, assistantMessage];
}

type ToolResultEntry = {
	query?: string;
	result?: string;
	success?: boolean;
};

function isToolResultArray(value: unknown): value is ToolResultEntry[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		typeof value[0] === "object" &&
		value[0] !== null &&
		"result" in value[0]
	);
}

type ExpandedToolEvent = {
	id: string;
	name: string;
	title: string;
	state: ToolEvent["state"];
	output: string;
	error?: string;
};

function formatInputSummary(input: unknown): string {
	if (input == null) {
		return "";
	}
	if (typeof input === "string") {
		return input;
	}
	if (typeof input === "object") {
		const values = Object.values(input as Record<string, unknown>);
		return values
			.filter((v) => typeof v === "string" || typeof v === "number")
			.map(String)
			.join(" ");
	}
	return String(input);
}

function formatRawOutput(output: unknown, fallback: string): string {
	if (output == null) {
		return fallback;
	}
	if (typeof output === "string") {
		return output;
	}
	return JSON.stringify(output, null, 2);
}

function expandToolEvent(toolEvent: ToolEvent): ExpandedToolEvent[] {
	if (isToolResultArray(toolEvent.output)) {
		return toolEvent.output.map((entry, index) => {
			const query = entry.query ?? "";
			const title = query ? `${toolEvent.name}: ${query}` : toolEvent.name;
			const state: ToolEvent["state"] =
				entry.success === false ? "output-error" : toolEvent.state;
			const output =
				entry.result ?? (entry.success === false ? "(failed)" : "(no output)");
			const error =
				entry.success === false ? (entry.result ?? "failed") : undefined;
			return {
				id: `${toolEvent.id}-${index}`,
				name: toolEvent.name,
				title,
				state,
				output,
				error,
			};
		});
	}

	const inputSummary = formatInputSummary(toolEvent.input);
	const title = inputSummary
		? `${toolEvent.name}: ${inputSummary}`
		: toolEvent.name;

	return [
		{
			id: toolEvent.id,
			name: toolEvent.name,
			title,
			state: toolEvent.state,
			output:
				toolEvent.error ?? formatRawOutput(toolEvent.output, toolEvent.text),
			error: toolEvent.error,
		},
	];
}

function extractToolName(text: string): string {
	const runningMatch = /^Running (.+)\.\.\.$/.exec(text);
	if (runningMatch?.[1]) {
		return runningMatch[1];
	}
	const terminalMatch = /^(.+?) (completed|failed:.*)$/.exec(text);
	return terminalMatch?.[1] ?? "tool";
}

function deriveToolState(text: string): ToolEvent["state"] {
	if (text.includes("failed:")) {
		return "output-error";
	}
	if (text.endsWith("completed")) {
		return "output-available";
	}
	return "input-available";
}

function mapToolEventState(
	event?: WebviewToolEvent,
	fallbackText?: string,
): ToolEvent["state"] {
	if (event?.status === "failed") {
		return "output-error";
	}
	if (event?.status === "completed") {
		return "output-available";
	}
	if (event?.status === "running") {
		return "input-available";
	}
	return deriveToolState(fallbackText ?? "");
}

function upsertToolEvent(events: ToolEvent[], next: ToolEvent): ToolEvent[] {
	const existingIndex = events.findIndex(
		(event) =>
			(event.toolCallId &&
				next.toolCallId &&
				event.toolCallId === next.toolCallId) ||
			(!event.toolCallId &&
				!next.toolCallId &&
				event.name === next.name &&
				event.state === "input-available" &&
				next.state !== "input-available"),
	);

	if (existingIndex === -1) {
		return [...events, next];
	}

	return events.map((event, index) =>
		index === existingIndex
			? {
					...event,
					text: next.text,
					state: next.state,
					output: next.output,
					error: next.error,
				}
			: event,
	);
}

function appendToolEvent(
	current: ChatMessage[],
	text: string,
	event: WebviewToolEvent | undefined,
	activeAssistantIdRef: MutableRefObject<string | undefined>,
): ChatMessage[] {
	const activeAssistantId = activeAssistantIdRef.current;
	const toolEvent: ToolEvent = {
		id: nanoid(),
		toolCallId: event?.toolCallId,
		name: event?.toolName ?? extractToolName(text),
		state: mapToolEventState(event, text),
		text,
		input: event?.input,
		output: event?.output,
		error: event?.error,
	};

	if (activeAssistantId) {
		return current.map((message) =>
			message.id === activeAssistantId
				? {
						...message,
						toolEvents: upsertToolEvent(message.toolEvents ?? [], toolEvent),
						blocks: upsertToolBlock(message.blocks, toolEvent),
					}
				: message,
		);
	}

	return [
		...current,
		createMessage("meta", text, {
			toolEvents: [toolEvent],
			blocks: [{ id: nanoid(), type: "tool", toolEvent }],
		}),
	];
}

function mergeHydratedMessagesWithLive(
	hydrated: ChatMessage[],
	current: ChatMessage[],
): ChatMessage[] {
	if (current.length === 0) {
		return hydrated;
	}
	const next = [...hydrated];
	for (const live of current) {
		const last = next.at(-1);
		if (live.role === "assistant" && last?.role === "assistant") {
			next[next.length - 1] = {
				...last,
				text: `${last.text}${live.text}`,
				reasoning:
					`${last.reasoning ?? ""}${live.reasoning ?? ""}` || undefined,
				reasoningRedacted:
					last.reasoningRedacted || live.reasoningRedacted || undefined,
				toolEvents: [...(last.toolEvents ?? []), ...(live.toolEvents ?? [])],
				blocks: [...(last.blocks ?? []), ...(live.blocks ?? [])],
			};
			continue;
		}
		if (
			live.role === "meta" &&
			last?.role === "meta" &&
			(live.toolEvents?.length ?? 0) > 0
		) {
			next[next.length - 1] = {
				...last,
				text: live.text || last.text,
				toolEvents: [...(last.toolEvents ?? []), ...(live.toolEvents ?? [])],
				blocks: [...(last.blocks ?? []), ...(live.blocks ?? [])],
			};
			continue;
		}
		next.push(live);
	}
	return next;
}

function renderToolEvent(
	toolEvent: ToolEvent,
	className: string,
): ReactElement[] {
	return expandToolEvent(toolEvent).map((expanded) => (
		<Tool className={className} key={expanded.id}>
			<ToolHeader
				state={expanded.state}
				title={expanded.title}
				type="dynamic-tool"
				toolName={expanded.name}
			/>
			<ToolContent>
				<ToolOutput errorText={expanded.error} output={expanded.output} />
			</ToolContent>
		</Tool>
	));
}

function legacyMessageBlocks(message: ChatMessage): ChatMessageBlock[] {
	const blocks: ChatMessageBlock[] = [];
	for (const toolEvent of message.toolEvents ?? []) {
		blocks.push({ id: `legacy-tool-${toolEvent.id}`, type: "tool", toolEvent });
	}
	if (message.reasoning) {
		blocks.push({
			id: `legacy-reasoning-${message.id}`,
			type: "reasoning",
			text: message.reasoning,
			redacted: message.reasoningRedacted,
		});
	}
	if (message.text) {
		blocks.push({
			id: `legacy-text-${message.id}`,
			type: "text",
			text: message.text,
		});
	}
	return blocks;
}

function renderMessageBlocks(
	message: ChatMessage,
	options: { isMeta?: boolean; sending?: boolean },
): ReactElement[] {
	const blocks = message.blocks?.length
		? message.blocks
		: legacyMessageBlocks(message);
	return blocks.flatMap((block) => {
		switch (block.type) {
			case "tool":
				if (block.toolEvent.name.startsWith("team_")) {
					return [
						<TeamTasks
							className={options.isMeta ? "mt-3 w-full" : "mb-3 w-full"}
							events={[block.toolEvent] as TeamToolEvent[]}
							key={block.id}
						/>,
					];
				}
				return renderToolEvent(
					block.toolEvent,
					options.isMeta ? "mt-3" : "mb-3",
				);
			case "reasoning":
				return [
					<Reasoning
						className={options.isMeta ? "mt-3" : "mb-3"}
						defaultOpen={false}
						key={block.id}
					>
						<ReasoningTrigger />
						<ReasoningContent>{block.text}</ReasoningContent>
					</Reasoning>,
				];
			case "text":
				if (options.isMeta) {
					return [
						<pre className="whitespace-pre-wrap font-inherit" key={block.id}>
							{block.text}
						</pre>,
					];
				}
				return [
					<MessageContent key={block.id}>
						<MessageResponse>{block.text}</MessageResponse>
					</MessageContent>,
				];
		}
		return [];
	});
}

function finalizeAssistantTurn(
	current: ChatMessage[],
	finishReason: string,
	iterations: number,
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
	},
): ChatMessage[] {
	return [
		...current,
		createMessage(
			"meta",
			`Done (${finishReason}) • iterations=${iterations} • input=${usage?.inputTokens ?? 0} output=${usage?.outputTokens ?? 0}`,
		),
	];
}

function formatSessionLabel(session: WebviewSessionSummary): string {
	const title = session.title?.trim() || session.sessionId.slice(0, 12);
	const status = session.status?.trim();
	const workspaceName = session.workspaceRoot?.trim()
		? session.workspaceRoot.trim().split("/").pop()
		: undefined;
	return [title, status ? `(${status})` : undefined, workspaceName]
		.filter(Boolean)
		.join(" • ");
}

function formatCheckpointTime(createdAt: number): string {
	try {
		return new Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		}).format(new Date(createdAt));
	} catch {
		return "Checkpoint";
	}
}

export default function Chat() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [status, setStatus] = useState("Waiting for RPC initialization...");
	const [sessionId, setSessionId] = useState<string>();
	const [sending, setSending] = useState(false);
	const [providers, setProviders] = useState<ProviderOption[]>([]);
	const [modelsByProvider, setModelsByProvider] = useState<
		Record<string, WebviewProviderModel[]>
	>({});
	const [defaults, setDefaults] = useState<WebviewDefaults>({
		workspaceRoot: "",
		cwd: "",
	});
	const [sessions, setSessions] = useState<WebviewSessionSummary[]>([]);
	const [sessionTitleDraft, setSessionTitleDraft] = useState("");
	const [lastSelection, setLastSelection] =
		useState<ModelSelectionStorage>(readModelSelection);
	const [provider, setProvider] = useState(() => lastSelection.lastProvider);
	const [model, setModel] = useState(
		() => lastSelection.lastModelByProvider[lastSelection.lastProvider] ?? "",
	);
	const [systemPrompt, setSystemPrompt] = useState("");
	const [maxIterations, setMaxIterations] = useState("");
	const [mode, setMode] = useState<"act" | "plan">("act");
	const [thinking, setThinking] = useState(false);
	const [enableTools, setEnableTools] = useState(true);
	const [enableSpawn, setEnableSpawn] = useState(true);
	const [enableTeams, setEnableTeams] = useState(false);
	const [autoApproveTools, setAutoApproveTools] = useState(true);
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
	const [titleEditing, setTitleEditing] = useState(false);
	const [forking, setForking] = useState(false);
	const [forkError, setForkError] = useState<string | null>(null);
	const activeAssistantIdRef = useRef<string | undefined>(undefined);
	const lastSelectionRef = useRef(lastSelection);
	const sessionsRef = useRef(sessions);
	const defaultsRef = useRef(defaults);

	useEffect(() => {
		sessionsRef.current = sessions;
	}, [sessions]);

	useEffect(() => {
		defaultsRef.current = defaults;
	}, [defaults]);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<WebviewOutboundMessage>) => {
			const message = event.data;
			if (!message || typeof message !== "object" || !("type" in message)) {
				return;
			}

			switch (message.type) {
				case "status":
					setStatus(message.text);
					return;
				case "error":
					setStatus(`Error: ${message.text}`);
					setSending(false);
					activeAssistantIdRef.current = undefined;
					setMessages((current) => {
						if (current.length === 0) {
							return current;
						}
						const nextText = `Error: ${message.text}`;
						const last = current.at(-1);
						if (last?.role === "error" && last.text === nextText) {
							return current;
						}
						return [...current, createMessage("error", nextText)];
					});
					return;
				case "defaults":
					setDefaults(message.defaults);
					if (message.defaults.provider) {
						setProvider(message.defaults.provider);
					}
					if (message.defaults.model) {
						setModel(message.defaults.model);
					}
					return;
				case "sessions":
					setSessions(message.sessions);
					return;
				case "providers":
					setProviders(message.providers);
					setProvider((current) => {
						const currentProvider =
							current && message.providers.some((item) => item.id === current)
								? current
								: "";
						const savedProvider = readModelSelection().lastProvider;
						const nextProvider =
							currentProvider ||
							(savedProvider &&
							message.providers.some((item) => item.id === savedProvider)
								? savedProvider
								: "") ||
							message.providers.find((item) => item.enabled)?.id ||
							message.providers[0]?.id ||
							"";
						if (nextProvider) {
							postToHost({ type: "loadModels", providerId: nextProvider });
						}
						return nextProvider;
					});
					return;
				case "models":
					setModelsByProvider((current) => ({
						...current,
						[message.providerId]: message.models,
					}));
					setModel((current) => {
						if (current && message.models.some((item) => item.id === current)) {
							return current;
						}
						const nextDefaults = defaultsRef.current;
						if (
							nextDefaults.provider === message.providerId &&
							nextDefaults.model &&
							message.models.some((item) => item.id === nextDefaults.model)
						) {
							return nextDefaults.model;
						}
						const saved = readModelSelection();
						const rememberedModel =
							saved.lastModelByProvider[message.providerId];
						if (
							rememberedModel &&
							message.models.some((item) => item.id === rememberedModel)
						) {
							return rememberedModel;
						}
						return message.models[0]?.id || "";
					});
					return;
				case "session_started":
					setSessionId(message.sessionId);
					setTitleEditing(false);
					setSessionTitleDraft("");
					return;
				case "session_hydrated":
					setSessionId(message.sessionId);
					setSending(message.status === "running");
					if (message.providerId) {
						setProvider(message.providerId);
					}
					if (message.providerId && message.modelId) {
						const nextSelection: ModelSelectionStorage = {
							lastProvider: message.providerId,
							lastModelByProvider: {
								...lastSelectionRef.current.lastModelByProvider,
								[message.providerId]: message.modelId,
							},
						};
						lastSelectionRef.current = nextSelection;
						setLastSelection(nextSelection);
						writeModelSelection(nextSelection);
						setModel(message.modelId);
					}
					setTitleEditing(false);
					setSessionTitleDraft(
						sessionsRef.current
							.find((item) => item.sessionId === message.sessionId)
							?.title?.trim() || "",
					);
					setMessages((current) => {
						const merged =
							message.status === "running"
								? mergeHydratedMessagesWithLive(
										message.messages as ChatMessage[],
										current,
									)
								: (message.messages as ChatMessage[]);
						activeAssistantIdRef.current =
							message.status === "running"
								? [...merged]
										.reverse()
										.find((item) => item.role === "assistant")?.id
								: undefined;
						return merged;
					});
					setStatus(
						message.status === "running"
							? `Attached to ${message.sessionId} (running)`
							: `Attached to ${message.sessionId}`,
					);
					return;
				case "assistant_delta":
					setMessages((current) =>
						appendAssistantDelta(current, message.text, activeAssistantIdRef),
					);
					return;
				case "reasoning_delta":
					setMessages((current) =>
						appendReasoningDelta(
							current,
							message.text,
							message.redacted,
							activeAssistantIdRef,
						),
					);
					return;
				case "tool_event":
					setMessages((current) =>
						appendToolEvent(
							current,
							message.text,
							message.event,
							activeAssistantIdRef,
						),
					);
					return;
				case "turn_done":
					setStatus(`Done (${message.finishReason})`);
					setSending(false);
					activeAssistantIdRef.current = undefined;
					setMessages((current) =>
						finalizeAssistantTurn(
							current,
							message.finishReason,
							message.iterations,
							message.usage,
						),
					);
					return;
				case "reset_done":
					setSessionId(undefined);
					setSending(false);
					setTitleEditing(false);
					setSessionTitleDraft("");
					activeAssistantIdRef.current = undefined;
					setStatus("Started a new chat session.");
					setMessages([]);
					return;
				case "fork_done":
					setForking(false);
					setForkError(null);
					setStatus(`Forked → new session ${message.newSessionId}`);
					return;
				case "fork_error":
					setForking(false);
					setForkError(message.text);
					setStatus(`Fork failed: ${message.text}`);
					return;
			}
		};

		window.addEventListener("message", handleMessage);
		postToHost({ type: "ready" });
		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, []);

	useEffect(() => {
		if (provider) {
			postToHost({ type: "loadModels", providerId: provider });
		}
	}, [provider]);

	useEffect(() => {
		if (!provider || !model) {
			return;
		}
		const previous = lastSelectionRef.current;
		if (
			previous.lastProvider === provider &&
			previous.lastModelByProvider[provider] === model
		) {
			return;
		}
		const nextSelection: ModelSelectionStorage = {
			lastProvider: provider,
			lastModelByProvider: {
				...previous.lastModelByProvider,
				[provider]: model,
			},
		};
		lastSelectionRef.current = nextSelection;
		setLastSelection(nextSelection);
		writeModelSelection(nextSelection);
	}, [provider, model]);

	const models = modelsByProvider[provider] ?? [];
	const thinkingEnabled =
		thinking &&
		models.find((item) => item.id === model)?.supportsThinking === true;
	const visibleMessages = useMemo(
		() => messages.filter((message) => message.role !== "meta" || message.text),
		[messages],
	);
	const sessionTitle =
		sessionId &&
		typeof sessions.find((item) => item.sessionId === sessionId)?.title ===
			"string"
			? sessions.find((item) => item.sessionId === sessionId)?.title?.trim() ||
				""
			: "";
	const displayedSessionTitle = titleEditing ? sessionTitleDraft : sessionTitle;

	const commitSessionTitle = () => {
		if (!sessionId) {
			setTitleEditing(false);
			return;
		}
		const normalized = sessionTitleDraft.replace(/\s+/g, " ").trim();
		setTitleEditing(false);
		if (normalized === sessionTitle) {
			return;
		}
		setSessionTitleDraft(normalized);
		postToHost({
			type: "updateSessionMetadata",
			sessionId,
			metadata: {
				title: normalized,
			},
		});
	};

	return (
		<PromptInputProvider>
			<div className="relative flex h-screen flex-col overflow-hidden">
				<div className="flex items-center justify-between border-b px-4 py-3">
					<div className="min-w-0">
						<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
							Cline
						</p>
					</div>
					<div className="flex items-center gap-2">
						{sessions.length > 0 ? (
							<select
								className="max-w-48 rounded-md border bg-background px-2 py-1 text-xs"
								onChange={(event) => {
									const nextSessionId = event.target.value;
									if (!nextSessionId) {
										postToHost({ type: "reset" });
										setStatus("Resetting session...");
										return;
									}
									setMessages([]);
									setSending(false);
									activeAssistantIdRef.current = undefined;
									setStatus(`Attaching to ${nextSessionId}...`);
									postToHost({
										type: "attachSession",
										sessionId: nextSessionId,
									});
								}}
								value={sessionId ?? ""}
							>
								<option value="">New session</option>
								{sessions.map((item) => (
									<option key={item.sessionId} value={item.sessionId}>
										{formatSessionLabel(item)}
									</option>
								))}
							</select>
						) : null}
						{sessionId ? (
							<input
								className="min-w-0 max-w-56 rounded-md border bg-muted px-2 py-1 text-xs"
								onBlur={commitSessionTitle}
								onChange={(event) => setSessionTitleDraft(event.target.value)}
								onFocus={() => {
									setTitleEditing(true);
									setSessionTitleDraft(sessionTitle);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										commitSessionTitle();
									}
								}}
								placeholder="Session title"
								value={displayedSessionTitle}
							/>
						) : null}
						{sessionId ? (
							<Button
								onClick={() => {
									setStatus(`Deleting ${sessionId}...`);
									postToHost({ type: "deleteSession", sessionId });
								}}
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<Trash2Icon className="size-4" />
								<span className="sr-only">Delete session</span>
							</Button>
						) : null}
						<Button
							onClick={() => {
								postToHost({ type: "reset" });
								setStatus("Resetting session...");
							}}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<PlusIcon className="size-4" />
							<span className="sr-only">New chat</span>
						</Button>
					</div>
				</div>
				<Conversation className="min-h-0 flex-1">
					<ConversationContent className="px-4 py-5">
						{visibleMessages.length === 0 ? (
							<div className="flex h-full items-center align-middle justify-center rounded-xl border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
								How can I help you?
							</div>
						) : null}
						{visibleMessages.map((message) => {
							if (message.role === "meta" || message.role === "error") {
								return (
									<div
										className={cn(
											"w-full rounded-lg border px-4 py-3 text-sm",
											message.role === "error"
												? "border-destructive/40 bg-destructive/10 text-destructive"
												: "bg-muted/40 text-muted-foreground",
										)}
										key={message.id}
									>
										{renderMessageBlocks(message, { isMeta: true })}
									</div>
								);
							}

							return (
								<Message from={message.role} key={message.id}>
									<div>
										{renderMessageBlocks(message, { sending })}
										{message.role === "user" && message.checkpoint ? (
											<Checkpoint className="mt-1 justify-end">
												<CheckpointTrigger
													className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
													disabled={sending}
													onClick={() => {
														if (message.checkpoint) {
															postToHost({
																type: "restore",
																checkpointRunCount: message.checkpoint.runCount,
															});
														}
													}}
													tooltip={`Checkpoint from run ${message.checkpoint.runCount}`}
													type="button"
													variant="ghost"
												>
													<CheckpointIcon className="size-3" />
													{formatCheckpointTime(message.checkpoint.createdAt)}
												</CheckpointTrigger>
											</Checkpoint>
										) : null}
										{message.role === "assistant" && !sending ? (
											<div className="mt-1 flex items-center gap-1">
												<Button
													className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
													disabled={forking}
													onClick={() => {
														setForking(true);
														setForkError(null);
														postToHost({ type: "forkSession" });
													}}
													size="sm"
													title="Fork session — copy full message history into a new session"
													type="button"
													variant="ghost"
												>
													{forking ? (
														<Loader2Icon className="size-3 animate-spin" />
													) : (
														<GitBranchIcon className="size-3" />
													)}
													Fork
												</Button>
												{forkError ? (
													<span className="text-[11px] text-destructive">
														{forkError}
													</span>
												) : null}
											</div>
										) : null}
									</div>
								</Message>
							);
						})}
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>
				<Composer
					autoApproveTools={autoApproveTools}
					enableSpawn={enableSpawn}
					enableTeams={enableTeams}
					enableTools={enableTools}
					maxIterations={maxIterations}
					model={model}
					mode={mode}
					modelSelectorOpen={modelSelectorOpen}
					models={models}
					onAbort={() => {
						postToHost({ type: "abort" });
						setStatus("Abort requested...");
					}}
					onAutoApproveToolsChange={setAutoApproveTools}
					onEnableSpawnChange={setEnableSpawn}
					onEnableTeamsChange={setEnableTeams}
					onEnableToolsChange={setEnableTools}
					onModeChange={setMode}
					onMaxIterationsChange={setMaxIterations}
					onModelChange={setModel}
					onModelSelectorOpenChange={setModelSelectorOpen}
					onProviderChange={(nextProvider) => {
						setProvider(nextProvider);
						const rememberedModel =
							lastSelection.lastModelByProvider[nextProvider];
						const providerModelIds = (modelsByProvider[nextProvider] ?? []).map(
							(item) => item.id,
						);
						if (rememberedModel && providerModelIds.includes(rememberedModel)) {
							setModel(rememberedModel);
							return;
						}
						setModel("");
					}}
					onSend={({ prompt, attachments, attachmentCount }) => {
						const assistantMessage = createMessage("assistant", "");
						activeAssistantIdRef.current = assistantMessage.id;
						setMessages((current) => [
							...current,
							createMessage(
								"user",
								buildUserMessageLabel(prompt, attachments, attachmentCount),
							),
							assistantMessage,
						]);
						setSending(true);
						setStatus("Running...");
						postToHost({
							type: "send",
							prompt,
							attachments,
							config: {
								autoApproveTools,
								enableSpawn,
								enableTeams,
								enableTools,
								maxIterations: parseMaxIterations(maxIterations),
								model: model || undefined,
								mode,
								provider: provider || undefined,
								systemPrompt: systemPrompt.trim() || undefined,
								thinking: thinkingEnabled,
							},
						});
					}}
					onSystemPromptChange={setSystemPrompt}
					onThinkingChange={setThinking}
					provider={provider}
					providers={providers}
					sending={sending}
					status={status}
					systemPrompt={systemPrompt}
					thinking={thinkingEnabled}
					workspaceRoot={defaults.workspaceRoot}
				/>
			</div>
		</PromptInputProvider>
	);
}
