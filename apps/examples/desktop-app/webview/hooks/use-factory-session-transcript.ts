"use client";

import { useEffect, useState } from "react";
import type { ChatMessage } from "@/lib/chat-schema";
import { desktopClient } from "@/lib/desktop-client";

export type FactorySessionTranscriptStatus =
	| "loading"
	| "live"
	| "ended"
	| "unavailable";

export type FactorySessionTranscript = {
	messages: ChatMessage[];
	status: FactorySessionTranscriptStatus;
	/** Set while the last read failed; the messages from before stay. */
	error?: string;
	/** False while the desktop transport is reconnecting. */
	connected: boolean;
};

/** Refetches for one session happen at most this often. */
export const FACTORY_TRANSCRIPT_REFRESH_MS = 1500;
/** Same cap as the chat view's history reads. */
const MAX_MESSAGES = 800;
export const FACTORY_TRANSCRIPT_UNAVAILABLE =
	"This session is no longer available.";

const NO_MESSAGES: ChatMessage[] = [];

type TranscriptState = {
	sessionId: string;
	messages: ChatMessage[];
	loaded: boolean;
	ended: boolean;
	error?: string;
};

function eventSessionId(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const sessionId = (payload as { sessionId?: unknown }).sessionId;
	return typeof sessionId === "string" ? sessionId : undefined;
}

/**
 * A Factory role session's transcript, read-only. Reads it with
 * `read_session_messages` on mount and again — at most once per
 * {@link FACTORY_TRANSCRIPT_REFRESH_MS} — when a `task.factory.activity` or
 * `chat_session_status` event arrives for the session, and once more after
 * the transport reconnects. Stops after `chat_session_ended` (one final read
 * picks up the last messages). Never attaches to the session and never polls.
 *
 * `options.ended` marks a session already known to be finished (e.g. from
 * {@link useFactoryLiveActivity}); it reads once and then waits.
 */
export function useFactorySessionTranscript(
	sessionId: string | null | undefined,
	options: { ended?: boolean } = {},
): FactorySessionTranscript {
	const knownEnded = options.ended === true;
	const [state, setState] = useState<TranscriptState | null>(null);
	const [connected, setConnected] = useState(true);

	useEffect(() => {
		if (!sessionId) return;
		let disposed = false;
		let ended = knownEnded;
		let lastReadAt = Number.NEGATIVE_INFINITY;
		let timer: ReturnType<typeof setTimeout> | undefined;
		// Reads can overlap when one is slow; only the newest one applies.
		let issued = 0;
		let applied = 0;
		setState((current) =>
			current?.sessionId === sessionId
				? { ...current, ended }
				: { sessionId, messages: NO_MESSAGES, loaded: false, ended },
		);

		const read = () => {
			timer = undefined;
			lastReadAt = Date.now();
			const request = ++issued;
			desktopClient
				.invoke<ChatMessage[]>("read_session_messages", {
					sessionId,
					maxMessages: MAX_MESSAGES,
				})
				.then((messages) => {
					if (disposed || request < applied) return;
					applied = request;
					setState({
						sessionId,
						messages: Array.isArray(messages) ? messages : NO_MESSAGES,
						loaded: true,
						ended,
					});
				})
				.catch(() => {
					if (disposed || request < applied) return;
					applied = request;
					setState((current) => ({
						sessionId,
						messages:
							current?.sessionId === sessionId ? current.messages : NO_MESSAGES,
						loaded: true,
						ended,
						error: FACTORY_TRANSCRIPT_UNAVAILABLE,
					}));
				});
		};
		// Leading read when the window is open, else one trailing read at the
		// end of the window; bursts in between collapse into it.
		const refresh = () => {
			if (disposed || timer !== undefined) return;
			const wait = lastReadAt + FACTORY_TRANSCRIPT_REFRESH_MS - Date.now();
			if (wait <= 0) read();
			else timer = setTimeout(read, wait);
		};
		const onSessionEvent = (payload: unknown) => {
			if (ended || eventSessionId(payload) !== sessionId) return;
			refresh();
		};

		read();
		const unsubscribe = [
			desktopClient.subscribe("task.factory.activity", onSessionEvent),
			desktopClient.subscribe("chat_session_status", onSessionEvent),
			desktopClient.subscribe("chat_session_ended", (payload) => {
				if (ended || eventSessionId(payload) !== sessionId) return;
				ended = true;
				setState((current) =>
					current?.sessionId === sessionId ? { ...current, ended } : current,
				);
				// The final read; nothing is scheduled after it.
				refresh();
			}),
		];
		let wasConnected = true;
		const unsubscribeTransport = desktopClient.subscribeTransportState(
			(transport) => {
				const isConnected =
					transport === "connected" || transport === "connecting";
				setConnected(isConnected);
				// Events may have been missed while the transport was down.
				if (isConnected && !wasConnected && !ended) refresh();
				wasConnected = isConnected;
			},
		);
		return () => {
			disposed = true;
			if (timer !== undefined) clearTimeout(timer);
			for (const stop of unsubscribe) stop();
			unsubscribeTransport();
		};
	}, [sessionId, knownEnded]);

	if (!sessionId) {
		return {
			messages: NO_MESSAGES,
			status: "unavailable",
			error: FACTORY_TRANSCRIPT_UNAVAILABLE,
			connected,
		};
	}
	// Until the effect has run for a new session, never show the previous
	// session's messages.
	if (!state || state.sessionId !== sessionId) {
		return { messages: NO_MESSAGES, status: "loading", connected };
	}
	const status: FactorySessionTranscriptStatus = !state.loaded
		? "loading"
		: state.error
			? "unavailable"
			: state.ended
				? "ended"
				: "live";
	return {
		messages: state.messages,
		status,
		...(state.error ? { error: state.error } : {}),
		connected,
	};
}
