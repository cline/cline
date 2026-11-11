"use client";

import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import { experimental_useRealtime } from "@ai-sdk/react";
import type {
	Experimental_RealtimeServerEvent,
	Experimental_RealtimeSessionConfig,
	UIMessage,
} from "ai";
import { PhoneOff, SendHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToolApprovalRequestItem } from "@/hooks/chat-session/types";
import type { UseSessionHistoryResult } from "@/hooks/use-session-history";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	desktopClient,
	resolveDesktopBackendWsEndpoint,
} from "@/lib/desktop-client";
import { eventEnvironmentId } from "@/lib/session-identity";
import { cn } from "@/lib/utils";
import {
	getVoiceManagerActiveChat,
	type VoiceManagerActiveChat,
	waitForVoiceManagerActiveChat,
} from "@/lib/voice-manager-bridge";
import { ClineBot, type ClineBotState } from "./cline-bot";

const APP_UPDATE_PREFIX = "[app update]";

const INSTRUCTIONS = `You are Cline, a small friendly robot who lives in the corner of the Cline desktop app.
You manage the user's Cline coding agents, called sessions. You never write code yourself: you check on sessions, start new ones, send them instructions, interrupt them, and stop them.
Speak in short, casual sentences, usually one or two. Refer to sessions by their titles, never by IDs.
When the user mentions a session, call list_sessions to find it. Use read_session before summarizing what a session did.
To redirect a session that is running, use send_message with interrupt set to true, without stopping it first. To queue a follow-up instead, leave interrupt false.
Messages starting with "${APP_UPDATE_PREFIX}" come from the app, not the user. Give the user a quick heads-up about them in a few words.`;

const SESSION_ID_PARAM = {
	sessionId: {
		type: "string",
		description: "The session ID from list_sessions.",
	},
};

const SESSION_CONFIG: Experimental_RealtimeSessionConfig = {
	instructions: INSTRUCTIONS,
	inputAudioTranscription: {},
	turnDetection: { type: "server-vad" },
	tools: [
		{
			type: "function",
			name: "list_sessions",
			description:
				"List the user's recent sessions with their titles, status, and project.",
			parameters: { type: "object", properties: {} },
		},
		{
			type: "function",
			name: "read_session",
			description: "Read the recent messages of a session.",
			parameters: {
				type: "object",
				properties: SESSION_ID_PARAM,
				required: ["sessionId"],
			},
		},
		{
			type: "function",
			name: "open_session",
			description: "Show a session's chat on screen.",
			parameters: {
				type: "object",
				properties: SESSION_ID_PARAM,
				required: ["sessionId"],
			},
		},
		{
			type: "function",
			name: "start_session",
			description: "Start a new session with a task for Cline to work on.",
			parameters: {
				type: "object",
				properties: {
					prompt: {
						type: "string",
						description: "The task, written as the user would type it.",
					},
				},
				required: ["prompt"],
			},
		},
		{
			type: "function",
			name: "send_message",
			description:
				"Send a message to a session. A busy session gets it after its current work; set interrupt to deliver it right away instead.",
			parameters: {
				type: "object",
				properties: {
					...SESSION_ID_PARAM,
					message: { type: "string" },
					interrupt: { type: "boolean" },
				},
				required: ["sessionId", "message"],
			},
		},
		{
			type: "function",
			name: "stop_session",
			description: "Stop whatever a session is currently doing.",
			parameters: {
				type: "object",
				properties: SESSION_ID_PARAM,
				required: ["sessionId"],
			},
		},
		{
			type: "function",
			name: "respond_to_approval",
			description: "Approve or deny the tool call a session is waiting on.",
			parameters: {
				type: "object",
				properties: {
					...SESSION_ID_PARAM,
					approve: { type: "boolean" },
				},
				required: ["sessionId", "approve"],
			},
		},
	],
};

type VoiceManagerModelInfo = {
	transport: "openai-native" | "vercel-ai-gateway";
	modelId: string;
};

type PendingApprovals = {
	environmentId: string;
	items: ToolApprovalRequestItem[];
};

function truncate(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function messageText(message: UIMessage | undefined): string {
	return (
		message?.parts
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("")
			.trim() ?? ""
	);
}

const NOT_SENT = {
	ok: false,
	error: "The session did not accept the message.",
};

// `send` settles only when the agent's turn ends; wait just long enough to catch a prompt that was rejected outright.
function dispatchPrompt(
	chat: VoiceManagerActiveChat,
	prompt: string,
): Promise<boolean> {
	return Promise.race([
		chat.send(prompt).catch(() => false),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 2_000)),
	]);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function resolveSetupUrl(): Promise<string> {
	const url = new URL(await resolveDesktopBackendWsEndpoint());
	url.protocol = url.protocol === "wss:" ? "https:" : "http:";
	url.pathname = url.pathname.replace(/\/transport$/, "/voice-manager/setup");
	return url.toString();
}

export function VoiceManager({
	sessionHistory,
	onOpenSession,
	onNewThread,
	onOpenProviders,
}: {
	sessionHistory: UseSessionHistoryResult;
	onOpenSession: (sessionId: string) => Promise<unknown>;
	onNewThread: () => void;
	onOpenProviders: () => void;
}) {
	const [modelInfo, setModelInfo] = useState<VoiceManagerModelInfo>({
		transport: "openai-native",
		modelId: "gpt-realtime",
	});
	const model = useMemo(
		() =>
			modelInfo.transport === "openai-native"
				? createOpenAI({ apiKey: "sidecar" }).experimental_realtime(
						modelInfo.modelId,
					)
				: createGateway({ apiKey: "sidecar" }).experimental_realtime(
						modelInfo.modelId,
					),
		[modelInfo.modelId, modelInfo.transport],
	);
	const [setupUrl, setSetupUrl] = useState("");
	const [pendingConnect, setPendingConnect] = useState(false);
	const [setupError, setSetupError] = useState<string | null>(null);
	const [activity, setActivity] = useState<string | null>(null);
	const [toolsRunning, setToolsRunning] = useState(0);
	const [responding, setResponding] = useState(false);
	const [queuedUpdates, setQueuedUpdates] = useState<string[]>([]);
	const [draft, setDraft] = useState("");
	const greetedRef = useRef(false);
	const awaitingToolResponseRef = useRef(false);
	const pendingApprovalsRef = useRef(new Map<string, PendingApprovals>());
	const sessionHistoryRef = useRef(sessionHistory);
	sessionHistoryRef.current = sessionHistory;

	useEffect(() => {
		void resolveSetupUrl().then(setSetupUrl, () => {});
	}, []);

	const findSession = useCallback((sessionId: string) => {
		const history = sessionHistoryRef.current;
		const thread = history.threads.find(
			(item) => history.sessionById.get(item.id)?.sessionId === sessionId,
		);
		const session = thread ? history.sessionById.get(thread.id) : undefined;
		return { thread, session, title: thread?.title ?? "that session" };
	}, []);

	const runTool = useCallback(
		async (name: string, args: Record<string, unknown>): Promise<unknown> => {
			const sessionId =
				typeof args.sessionId === "string" ? args.sessionId : "";
			const { thread, session, title } = findSession(sessionId);
			switch (name) {
				case "list_sessions": {
					setActivity("Checking your sessions");
					const history = sessionHistoryRef.current;
					const openSessionId = getVoiceManagerActiveChat()?.sessionId;
					return history.threads
						.flatMap((item) => {
							const found = history.sessionById.get(item.id);
							if (!found || found.isSubagent) return [];
							return [
								{
									sessionId: found.sessionId,
									title: item.title,
									status: item.status,
									project: item.codebase,
									lastActive: item.time,
									onScreen: found.sessionId === openSessionId,
								},
							];
						})
						.slice(0, 15);
				}
				case "read_session": {
					setActivity(`Reading “${title}”`);
					const messages = await desktopClient.invoke<ChatMessage[]>(
						"read_session_messages",
						{
							sessionId,
							environmentId: session?.environmentId,
							maxMessages: 40,
						},
					);
					return {
						title,
						status: thread?.status,
						recent: messages
							.filter((message) =>
								["user", "assistant", "tool", "error"].includes(message.role),
							)
							.slice(-12)
							.map((message) => ({
								role: message.role,
								text:
									message.role === "tool"
										? `used ${message.meta?.toolName ?? "a tool"}`
										: truncate(message.content, 400),
							})),
					};
				}
				case "open_session": {
					setActivity(`Opening “${title}”`);
					await onOpenSession(sessionId);
					return { ok: true };
				}
				case "start_session": {
					const prompt = String(args.prompt ?? "").trim();
					setActivity("Starting a new session");
					const previousThreadId = getVoiceManagerActiveChat()?.threadId;
					onNewThread();
					const chat = await waitForVoiceManagerActiveChat(
						(candidate) =>
							candidate.threadId !== previousThreadId &&
							candidate.sessionId === null,
					);
					if (!(await dispatchPrompt(chat, prompt))) return NOT_SENT;
					const started = await waitForVoiceManagerActiveChat(
						(candidate) =>
							candidate.threadId === chat.threadId &&
							candidate.sessionId !== null,
						20_000,
					).catch(() => null);
					return started
						? { ok: true, sessionId: started.sessionId }
						: NOT_SENT;
				}
				case "send_message": {
					const message = String(args.message ?? "").trim();
					setActivity(`Messaging “${title}”`);
					if (getVoiceManagerActiveChat()?.sessionId !== sessionId) {
						await onOpenSession(sessionId);
					}
					const chat = await waitForVoiceManagerActiveChat(
						(candidate) =>
							candidate.sessionId === sessionId && !candidate.isHydrating,
					);
					const busy = chat.status === "running" || chat.status === "starting";
					if (args.interrupt === true && busy) {
						// Steering hands the message to the running agent at its next step.
						// Stopping it first would strand the message: the queue does not
						// drain while an abort settles.
						await desktopClient.invoke("chat_session_command", {
							request: {
								action: "send",
								sessionId,
								prompt: message,
								delivery: "steer",
							},
						});
						return { ok: true };
					}
					if (!(await dispatchPrompt(chat, message))) return NOT_SENT;
					return { ok: true, queued: busy };
				}
				case "stop_session": {
					setActivity(`Stopping “${title}”`);
					await desktopClient.invoke("chat_session_command", {
						request: { action: "abort", sessionId },
					});
					return { ok: true };
				}
				case "respond_to_approval": {
					const pending = pendingApprovalsRef.current.get(sessionId);
					if (!pending?.items.length) {
						return {
							ok: false,
							error: "Nothing in that session is waiting for approval.",
						};
					}
					setActivity(
						`${args.approve === true ? "Approving" : "Denying"} for “${title}”`,
					);
					for (const item of pending.items) {
						await desktopClient.invoke("respond_tool_approval", {
							environmentId: pending.environmentId,
							sessionId,
							requestId: item.requestId,
							approved: args.approve === true,
						});
					}
					return { ok: true, count: pending.items.length };
				}
				default:
					return { ok: false, error: `Unknown tool ${name}` };
			}
		},
		[findSession, onNewThread, onOpenSession],
	);

	const realtime = experimental_useRealtime({
		model,
		api: { token: setupUrl },
		sessionConfig: SESSION_CONFIG,
		onToolCall: async ({ toolCall }) => {
			setToolsRunning((count) => count + 1);
			try {
				return await runTool(
					toolCall.toolName,
					(toolCall.args ?? {}) as Record<string, unknown>,
				);
			} catch (error) {
				return { ok: false, error: errorText(error) };
			} finally {
				setToolsRunning((count) => count - 1);
			}
		},
		onEvent: (event: Experimental_RealtimeServerEvent) => {
			if (event.type === "function-call-arguments-done") {
				awaitingToolResponseRef.current = true;
			}
			if (event.type === "response-created") setResponding(true);
			if (event.type === "response-done") {
				// The SDK requests a follow-up response once tool outputs are in.
				setResponding(awaitingToolResponseRef.current);
				awaitingToolResponseRef.current = false;
			}
		},
		onError: (error) => setSetupError(errorText(error)),
	});
	const connected = realtime.status === "connected";

	const pushUpdate = useCallback((text: string) => {
		setQueuedUpdates((current) => [...current, text].slice(-5));
	}, []);

	useEffect(() => {
		const titleFor = (sessionId: string) => findSession(sessionId).title;
		const unsubscribeDone = desktopClient.subscribe("chat_event", (payload) => {
			const event = payload as {
				sessionId?: string;
				stream?: string;
				chunk?: unknown;
			};
			if (event?.stream !== "chat_done" || !event.sessionId) return;
			let done: { reason?: string; text?: string } = {};
			try {
				done = typeof event.chunk === "string" ? JSON.parse(event.chunk) : {};
			} catch {}
			const reason = String(done.reason ?? "").toLowerCase();
			if (reason === "aborted" || reason === "cancelled") return;
			const failed = reason === "error" || reason === "failed";
			pushUpdate(
				`Session “${titleFor(event.sessionId)}” ${failed ? "failed" : "finished"}.${
					done.text ? ` Its last message: ${truncate(done.text, 300)}` : ""
				}`,
			);
		});
		const unsubscribeApprovals = desktopClient.subscribe(
			"tool_approval_state",
			(payload) => {
				const record = payload as {
					sessionId?: string;
					items?: ToolApprovalRequestItem[];
				};
				if (!record?.sessionId || !Array.isArray(record.items)) return;
				const previous = pendingApprovalsRef.current.get(record.sessionId);
				pendingApprovalsRef.current.set(record.sessionId, {
					environmentId: eventEnvironmentId(payload),
					items: record.items,
				});
				for (const item of record.items) {
					if (previous?.items.some((old) => old.requestId === item.requestId))
						continue;
					pushUpdate(
						`Session “${titleFor(record.sessionId)}” is waiting for approval to use ${item.toolName}.`,
					);
				}
			},
		);
		return () => {
			unsubscribeDone();
			unsubscribeApprovals();
		};
	}, [findSession, pushUpdate]);

	useEffect(() => {
		if (!pendingConnect || !setupUrl) return;
		setPendingConnect(false);
		void realtime.connect();
	}, [pendingConnect, realtime.connect, setupUrl]);

	useEffect(() => {
		if (!connected) {
			greetedRef.current = false;
			return;
		}
		setSetupError(null);
		void realtime
			.resumeAudioCapture()
			.catch((error) => setSetupError(errorText(error)));
		void realtime.resumePlayback().catch(() => {});
	}, [connected, realtime.resumeAudioCapture, realtime.resumePlayback]);

	useEffect(() => {
		if (!connected || responding || toolsRunning > 0) return;
		if (!greetedRef.current) {
			greetedRef.current = true;
			const updates = queuedUpdates.length
				? ` While they were away: ${queuedUpdates.join(" ")}`
				: "";
			setQueuedUpdates([]);
			realtime.sendTextMessage(
				`${APP_UPDATE_PREFIX} The user just tapped you to start talking. Say hi in a few words.${updates}`,
			);
			return;
		}
		if (!queuedUpdates.length) return;
		setQueuedUpdates([]);
		realtime.sendTextMessage(`${APP_UPDATE_PREFIX} ${queuedUpdates.join(" ")}`);
	}, [
		connected,
		queuedUpdates,
		realtime.sendTextMessage,
		responding,
		toolsRunning,
	]);

	const start = useCallback(async () => {
		setSetupError(null);
		setActivity(null);
		try {
			setModelInfo(
				await desktopClient.invoke<VoiceManagerModelInfo>(
					"get_voice_manager_model",
				),
			);
			setPendingConnect(true);
		} catch (error) {
			setSetupError(errorText(error));
		}
	}, []);

	const active = realtime.status === "connecting" || connected;
	const botState: ClineBotState = connected
		? realtime.isPlaying
			? "speaking"
			: toolsRunning > 0 || responding
				? "thinking"
				: "listening"
		: realtime.status === "connecting" || pendingConnect
			? "connecting"
			: setupError || realtime.status === "error"
				? "error"
				: "idle";

	const visibleMessages = realtime.messages.filter(
		(message) =>
			!(
				message.role === "user" &&
				messageText(message).startsWith(APP_UPDATE_PREFIX)
			),
	);
	const lastText = (role: UIMessage["role"]) =>
		visibleMessages
			.filter((message) => message.role === role)
			.map(messageText)
			.findLast(Boolean) ?? "";
	const lastAssistant = lastText("assistant");
	const lastUser = lastText("user");
	const showBubble = active || Boolean(setupError);

	return (
		<div className="pointer-events-none fixed bottom-4 right-4 z-40 flex items-end gap-1">
			{showBubble ? (
				<div className="pointer-events-auto mb-12 flex w-72 flex-col gap-2 rounded-2xl rounded-br-sm border bg-popover/95 p-3 text-sm text-popover-foreground shadow-lg backdrop-blur">
					{setupError && !active ? (
						<div className="flex flex-col gap-2">
							<p className="text-destructive">{setupError}</p>
							{setupError.includes("Settings") ? (
								<button
									className="self-start text-xs font-medium text-primary hover:underline"
									onClick={onOpenProviders}
									type="button"
								>
									Open Providers
								</button>
							) : null}
						</div>
					) : (
						<>
							{lastUser ? (
								<p className="line-clamp-2 text-xs text-muted-foreground">
									You: {lastUser}
								</p>
							) : null}
							<p className="cline-chat-selectable line-clamp-6 leading-snug">
								{lastAssistant || (connected ? "I'm listening…" : "Waking up…")}
							</p>
							{activity && botState === "thinking" ? (
								<p className="text-xs text-muted-foreground">{activity}…</p>
							) : null}
							{setupError ? (
								<p className="text-xs text-destructive">{setupError}</p>
							) : null}
							<form
								className="flex items-center gap-1 border-t pt-2"
								onSubmit={(event) => {
									event.preventDefault();
									const text = draft.trim();
									if (!text || !connected) return;
									realtime.sendTextMessage(text);
									setDraft("");
								}}
							>
								<input
									aria-label="Type to Cline"
									className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
									disabled={!connected}
									onChange={(event) => setDraft(event.target.value)}
									placeholder="Or type to Cline…"
									value={draft}
								/>
								<button
									aria-label="Send to Cline"
									className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
									disabled={!connected || !draft.trim()}
									type="submit"
								>
									<SendHorizontal className="size-3.5" />
								</button>
								<button
									aria-label="Stop talking to Cline"
									className="rounded p-1 text-muted-foreground hover:text-destructive"
									onClick={() => realtime.disconnect()}
									type="button"
								>
									<PhoneOff className="size-3.5" />
								</button>
							</form>
						</>
					)}
				</div>
			) : null}
			<button
				aria-label={active ? "Stop talking to Cline" : "Talk to Cline"}
				className={cn(
					"pointer-events-auto relative size-[72px] rounded-full text-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				)}
				onClick={() => {
					if (active) realtime.disconnect();
					else void start();
				}}
				title={active ? "Stop talking to Cline" : "Talk to Cline"}
				type="button"
			>
				<ClineBot className="size-full" state={botState} />
				{!active && queuedUpdates.length > 0 ? (
					<span className="absolute right-1 top-0 grid size-4 place-items-center rounded-full bg-destructive text-[0.625rem] font-semibold text-white">
						{queuedUpdates.length}
					</span>
				) : null}
			</button>
		</div>
	);
}
