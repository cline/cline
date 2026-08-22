"use client";

import { useEffect } from "react";
import { DEFAULT_CHAT_CONFIG } from "@/hooks/chat-session/constants";
import type { ChatSessionCommandResponse } from "@/hooks/chat-session/types";
import type { BotSummary } from "@/hooks/use-bots";
import { DEFAULT_BOT_ID } from "@/hooks/use-bots";
import {
	type DesktopBackendTarget,
	desktopClient,
	tryTauriInvoke,
} from "@/lib/desktop-client";
import type { DesktopTransportMessage } from "@/lib/desktop-transport";

/**
 * Mirrors the sidecar's own MessageBotRequestItem/MessageBotResult shapes
 * (apps/cline/sidecar/types.ts) - kept as a local, independent type rather
 * than a shared import, since the webview and sidecar are separate
 * compilation units that only agree on the wire's JSON shape, not a type.
 */
export type MessageBotRequestItem = {
	requestId: string;
	createdAt: string;
	botName: string;
	message: string;
	mode: "fire_and_forget" | "await_reply";
	sessionId?: string;
	timeoutMs: number;
};

type MessageBotResultTarget = {
	botId?: string;
	botName?: string;
	sessionId?: string;
};

export type MessageBotResult = MessageBotResultTarget &
	(
		| { delivered: true; reply?: string; error?: never }
		| { delivered: false; reply?: never; error: string }
	);

type MessageBotTurnCompletion = {
	reason?: string;
	text?: string;
	error?: string;
};

type ChatDoneWaiter = {
	promise: Promise<MessageBotTurnCompletion>;
	cancel: () => void;
};

// Session setup (bot lookup, resolving + connecting to the target's own
// sidecar, then attach/start) happens before the timed portion (the actual
// send) even begins - bounded generously since it can include cold-starting
// the target bot's daemon (get_desktop_backend_endpoint's own 3x-retried
// startup), but short relative to a full agent turn.
const MESSAGE_BOT_SETUP_TIMEOUT_MS = 30_000;

function generateRequestId(prefix: string): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function connectDesktopSocket(
	endpoint: string,
	timeoutMs = MESSAGE_BOT_SETUP_TIMEOUT_MS,
): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(endpoint);
		const timeoutId = setTimeout(() => {
			cleanup();
			socket.close();
			reject(
				new Error(`Connection to ${endpoint} timed out after ${timeoutMs}ms`),
			);
		}, timeoutMs);
		const cleanup = () => {
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("error", onError);
			clearTimeout(timeoutId);
		};
		function onOpen() {
			cleanup();
			resolve(socket);
		}
		function onError() {
			cleanup();
			socket.close();
			reject(new Error(`Could not connect to ${endpoint}`));
		}
		socket.addEventListener("open", onOpen);
		socket.addEventListener("error", onError);
	});
}

/**
 * Sends one `{type:"command",...}` request over an already-open desktop
 * socket and resolves with its matching response - the same envelope
 * `desktop-client.ts`'s own DesktopClient speaks for the active thread (see
 * its `invoke`/`handleMessage`), reimplemented minimally here because this
 * throwaway connection to a *different*, non-active bot must never share
 * that singleton's state.
 */
function sendDesktopCommand<T>(
	socket: WebSocket,
	command: string,
	args: Record<string, unknown>,
	timeoutMs: number | null,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const id = generateRequestId("message_bot");
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			socket.removeEventListener("message", onMessage);
			socket.removeEventListener("close", onClose);
			if (timeoutId) clearTimeout(timeoutId);
		};
		function onMessage(event: MessageEvent) {
			let parsed: DesktopTransportMessage;
			try {
				parsed = JSON.parse(String(event.data));
			} catch {
				return;
			}
			if (parsed.type !== "response" || parsed.id !== id) return;
			cleanup();
			if (!parsed.ok) {
				reject(new Error(parsed.error || `command "${command}" failed`));
				return;
			}
			resolve(parsed.result as T);
		}
		function onClose() {
			cleanup();
			reject(new Error(`Connection closed while waiting for "${command}"`));
		}
		socket.addEventListener("message", onMessage);
		socket.addEventListener("close", onClose);
		if (timeoutMs !== null) {
			timeoutId = setTimeout(() => {
				cleanup();
				reject(
					new Error(`command "${command}" timed out after ${timeoutMs}ms`),
				);
			}, timeoutMs);
		}
		socket.send(JSON.stringify({ type: "command", id, command, args }));
	});
}

/**
 * Watches the target bot's throwaway socket for the terminal event of this
 * exact relayed turn. Fresh interactive sessions can queue their first prompt, in
 * which case the send RPC only acknowledges the queue and `chat_done` is the
 * sole completion signal. Install this before sending so a very fast turn
 * cannot finish between the command and listener registration.
 */
function createChatDoneWaiter(
	socket: WebSocket,
	sessionId: string,
	clientTurnId: string,
	timeoutMs: number,
	botName: string,
): ChatDoneWaiter {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let settled = false;
	let lastCoreError = "";
	let resolveWaiter: (value: MessageBotTurnCompletion) => void = () => {};
	let rejectWaiter: (error: Error) => void = () => {};

	const cleanup = () => {
		socket.removeEventListener("message", onMessage);
		socket.removeEventListener("close", onClose);
		if (timeoutId) clearTimeout(timeoutId);
	};
	const resolveOnce = (value: MessageBotTurnCompletion) => {
		if (settled) return;
		settled = true;
		cleanup();
		resolveWaiter(value);
	};
	const rejectOnce = (error: Error) => {
		if (settled) return;
		settled = true;
		cleanup();
		rejectWaiter(error);
	};
	function onMessage(event: MessageEvent) {
		let parsed: DesktopTransportMessage;
		try {
			parsed = JSON.parse(String(event.data));
		} catch {
			return;
		}
		if (parsed.type !== "event") {
			return;
		}
		if (!parsed.event.payload || typeof parsed.event.payload !== "object") {
			return;
		}
		const payload = parsed.event.payload as {
			sessionId?: string;
			clientTurnId?: string;
			stream?: string;
			chunk?: string;
			status?: string;
			reason?: string;
		};
		if (
			payload.sessionId !== sessionId ||
			payload.clientTurnId !== clientTurnId
		) {
			return;
		}
		if (parsed.event.name === "chat_session_status") {
			const status = payload.status?.trim().toLowerCase() ?? "";
			if (["failed", "error", "aborted", "cancelled"].includes(status)) {
				resolveOnce({
					reason: status === "failed" ? "error" : status,
					error: lastCoreError,
				});
			}
			return;
		}
		if (parsed.event.name === "chat_session_ended") {
			resolveOnce({
				reason: payload.reason?.trim() || "error",
				error: lastCoreError,
			});
			return;
		}
		if (
			parsed.event.name !== "chat_event" ||
			typeof payload.chunk !== "string"
		) {
			return;
		}
		if (payload.stream === "chat_core_log") {
			try {
				const log = JSON.parse(payload.chunk) as {
					level?: string;
					message?: string;
				};
				if (log.level === "error" && log.message?.trim()) {
					lastCoreError = log.message.trim();
				}
			} catch {
				// A malformed diagnostic should not prevent the terminal event.
			}
			return;
		}
		if (payload.stream !== "chat_done") return;

		let reason = "";
		let text = "";
		try {
			const done = JSON.parse(payload.chunk) as {
				reason?: string;
				text?: string;
			};
			reason = done.reason?.trim() ?? "";
			text = typeof done.text === "string" ? done.text.trim() : "";
		} catch {
			// The explicit empty-completion error below is clearer than a parse
			// exception that hides which bot/session actually ended.
		}
		resolveOnce({ reason, text, error: lastCoreError });
	}
	function onClose() {
		rejectOnce(
			new Error(`Connection to "${botName}" closed before it replied`),
		);
	}

	const promise = new Promise<MessageBotTurnCompletion>((resolve, reject) => {
		resolveWaiter = resolve;
		rejectWaiter = reject;
	});
	// The send command can remain in flight until the same deadline. Attach a
	// rejection handler now so a close/timeout that beats the command response
	// is not briefly reported as an unhandled promise rejection; awaiting the
	// original promise below still observes the rejection normally.
	void promise.catch(() => {});
	socket.addEventListener("message", onMessage);
	socket.addEventListener("close", onClose);
	timeoutId = setTimeout(() => {
		rejectOnce(
			new Error(
				`message_bot timed out waiting for "${botName}" after ${timeoutMs}ms`,
			),
		);
	}, timeoutMs);

	return {
		promise,
		cancel: () => {
			if (settled) return;
			settled = true;
			cleanup();
		},
	};
}

export function normalizeAwaitReplyResult(
	bot: Pick<BotSummary, "id" | "name">,
	sessionId: string,
	completion: MessageBotTurnCompletion,
): MessageBotResult {
	const reason = completion.reason?.trim() ?? "";
	const text = completion.text?.trim() ?? "";
	const coreError = completion.error?.trim() ?? "";
	const base = {
		botId: bot.id,
		botName: bot.name,
		sessionId,
	};

	if (reason && reason !== "completed") {
		const detail = text || coreError;
		return {
			delivered: false,
			...base,
			error: detail
				? `"${bot.name}" ended with ${reason}: ${detail}`
				: `"${bot.name}" ended with ${reason} and provided no error detail`,
		};
	}
	if (!text && coreError) {
		return {
			delivered: false,
			...base,
			error: `"${bot.name}" failed: ${coreError}`,
		};
	}
	if (!text) {
		return {
			delivered: false,
			...base,
			error: `"${bot.name}" completed without returning reply text`,
		};
	}
	return { delivered: true, ...base, reply: text };
}

function resolveTargetBot(
	botName: string,
	bots: BotSummary[],
): { bot: BotSummary } | { error: string } {
	const normalized = botName.trim().toLowerCase();
	const matches = bots.filter(
		(bot) => bot.name.trim().toLowerCase() === normalized,
	);
	if (matches.length === 0) {
		const available = bots.map((bot) => bot.name).join(", ") || "none";
		return {
			error: `No bot named "${botName}" found. Available bots: ${available}`,
		};
	}
	if (matches.length > 1) {
		return {
			error: `Multiple bots are named "${botName}" - ask the user to rename one of them so it can be targeted unambiguously.`,
		};
	}
	if (matches[0].id === DEFAULT_BOT_ID) {
		return { error: "Cannot use message_bot to message yourself." };
	}
	return { bot: matches[0] };
}

/**
 * Performs the actual cross-bot relay for one `message_bot_requested` event.
 * The tool's own `execute()` runs inside the "cline" bot's sandboxed process
 * tree, which has no path to another bot's sidecar (no filesystem access to
 * its discovery file, no network-allowlist entry for its port) - the webview
 * is the one unsandboxed layer that already reaches any bot via
 * `get_desktop_backend_endpoint`, so it does this work and calls back
 * `respond_message_bot` with the result.
 *
 * Always resolves (never throws) so a failure becomes a clear
 * `{delivered:false, error}` for the calling agent instead of an unhandled
 * rejection here.
 */
export async function relayMessageBot(
	item: MessageBotRequestItem,
): Promise<MessageBotResult> {
	const rawBotName = item.botName?.trim();
	if (!rawBotName) {
		return { delivered: false, error: "botName is required" };
	}

	let bots: BotSummary[];
	try {
		const state = await desktopClient.invoke<{ bots: BotSummary[] }>(
			"get_bots_state",
		);
		bots = state.bots;
	} catch (error) {
		return {
			delivered: false,
			botName: rawBotName,
			error: `Could not look up bots: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const resolved = resolveTargetBot(rawBotName, bots);
	if ("error" in resolved) {
		return { delivered: false, botName: rawBotName, error: resolved.error };
	}
	const targetBot = resolved.bot;

	let backendTarget: DesktopBackendTarget;
	try {
		backendTarget = await tryTauriInvoke<DesktopBackendTarget>(
			"get_desktop_backend_endpoint",
			{
				botId: targetBot.id,
				projectPath: "",
			},
		);
		if (
			!backendTarget.endpoint?.trim() ||
			!backendTarget.botId?.trim() ||
			!backendTarget.workspaceRoot?.trim()
		) {
			throw new Error("received an invalid backend target");
		}
	} catch (error) {
		return {
			delivered: false,
			botId: targetBot.id,
			botName: targetBot.name,
			error: `Could not reach "${targetBot.name}": ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	let socket: WebSocket;
	try {
		socket = await connectDesktopSocket(backendTarget.endpoint.trim());
	} catch (error) {
		return {
			delivered: false,
			botId: targetBot.id,
			botName: targetBot.name,
			error: `Could not connect to "${targetBot.name}": ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	let sessionId = item.sessionId?.trim();
	const desktopScope = {
		botId: backendTarget.botId.trim(),
		workspaceRoot: backendTarget.workspaceRoot.trim(),
	};
	try {
		if (sessionId) {
			await sendDesktopCommand(
				socket,
				"chat_session_command",
				{ request: { action: "attach", sessionId, desktopScope } },
				MESSAGE_BOT_SETUP_TIMEOUT_MS,
			);
		} else {
			const started = await sendDesktopCommand<{ sessionId?: string }>(
				socket,
				"chat_session_command",
				{
					request: {
						action: "start",
						config: { ...DEFAULT_CHAT_CONFIG, botId: desktopScope.botId },
						desktopScope,
					},
				},
				MESSAGE_BOT_SETUP_TIMEOUT_MS,
			);
			sessionId = started.sessionId?.trim();
			if (!sessionId) {
				throw new Error(`"${targetBot.name}" did not return a session id`);
			}
		}

		const clientTurnId = generateRequestId("message_bot_turn");
		const sendRequest = {
			action: "send",
			sessionId,
			prompt: item.message,
			clientTurnId,
			delivery: "queue",
			desktopScope,
		};
		if (item.mode === "fire_and_forget") {
			// Fire-and-forget skips model completion, but "delivered" still means
			// the target accepted the prompt into its queue.
			const sendResponse = await sendDesktopCommand<ChatSessionCommandResponse>(
				socket,
				"chat_session_command",
				{ request: sendRequest },
				Math.min(item.timeoutMs, MESSAGE_BOT_SETUP_TIMEOUT_MS),
			);
			socket.close();
			if (sendResponse.result?.finishReason === "error") {
				return normalizeAwaitReplyResult(targetBot, sessionId, {
					reason: "error",
					text: sendResponse.result.text,
				});
			}
			return {
				delivered: true,
				botId: targetBot.id,
				botName: targetBot.name,
				sessionId,
			};
		}

		const doneWaiter = createChatDoneWaiter(
			socket,
			sessionId,
			clientTurnId,
			item.timeoutMs,
			targetBot.name,
		);
		try {
			const sendResponse = await sendDesktopCommand<ChatSessionCommandResponse>(
				socket,
				"chat_session_command",
				{ request: sendRequest },
				item.timeoutMs,
			);
			if (sendResponse.result) {
				return normalizeAwaitReplyResult(targetBot, sessionId, {
					reason: sendResponse.result.finishReason,
					text: sendResponse.result.text,
				});
			}
			return normalizeAwaitReplyResult(
				targetBot,
				sessionId,
				await doneWaiter.promise,
			);
		} finally {
			doneWaiter.cancel();
			socket.close();
		}
	} catch (error) {
		socket.close();
		return {
			delivered: false,
			botId: targetBot.id,
			botName: targetBot.name,
			sessionId,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// Fast-Refresh/local duplicate guard. Cross-window ownership is coordinated
// atomically by claim_message_bot in the source sidecar.
const handledMessageBotRequestIds = new Set<string>();

async function handleMessageBotRequest(item: MessageBotRequestItem) {
	if (handledMessageBotRequestIds.has(item.requestId)) return;
	handledMessageBotRequestIds.add(item.requestId);
	let claimed = false;
	try {
		claimed = await desktopClient.invoke<boolean>("claim_message_bot", {
			requestId: item.requestId,
		});
	} catch {
		handledMessageBotRequestIds.delete(item.requestId);
		return;
	}
	if (!claimed) {
		handledMessageBotRequestIds.delete(item.requestId);
		return;
	}
	try {
		const result = await relayMessageBot(item);
		await desktopClient.invoke("respond_message_bot", {
			requestId: item.requestId,
			result,
		});
	} catch {
		// A source transport reconnect releases and re-offers this claim. Let the
		// renderer accept that replay instead of permanently suppressing it.
		handledMessageBotRequestIds.delete(item.requestId);
	}
}

/**
 * Fulfils `message_bot` tool calls from the default "cline" bot - see
 * apps/cline/sidecar/context.ts's requestSidecarMessageBot, which emits
 * `message_bot_requested` over the same already-open channel this hook
 * subscribes through and awaits `respond_message_bot` to resolve the tool
 * call. Mount once (in page.tsx, alongside the other top-level hooks) -
 * each event is handled independently, so concurrent `message_bot` calls
 * each get their own connection/relay, never shared state.
 */
export function useMessageBotRelay(): void {
	useEffect(() => {
		return desktopClient.subscribe("message_bot_requested", (payload) => {
			if (!payload || typeof payload !== "object") return;
			const item = payload as MessageBotRequestItem;
			if (!item.requestId || !item.botName || !item.message) return;
			void handleMessageBotRequest(item);
		});
	}, []);
}
