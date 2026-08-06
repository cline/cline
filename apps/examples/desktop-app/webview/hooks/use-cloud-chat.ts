"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	appendOptimisticUserMessage,
	applyCloudSessionEvent,
	type CloudChatState,
	type CloudSessionEventPayload,
	createCloudChatState,
} from "@/lib/cloud-live-events";
import {
	abortCloudRun,
	type CloudConnectionState,
	connectCloudSession,
	disconnectCloudSession,
	fetchCloudSessionHistory,
	respondCloudApproval,
	sendCloudPrompt,
} from "@/lib/cloud-sessions";
import { desktopClient } from "@/lib/desktop-client";

export type UseCloudChatResult = {
	connectionState: CloudConnectionState;
	connectionError: string | null;
	chat: CloudChatState;
	agentSessionId: string | null;
	isHydrating: boolean;
	sendPrompt: (prompt: string, modelId?: string) => Promise<void>;
	abortRun: () => Promise<void>;
	respondApproval: (approvalId: string, approved: boolean) => Promise<void>;
	reconnect: () => void;
};

/**
 * Live chat state for one connected cloud (remote) session. Connects the
 * sandbox hub through the sidecar, hydrates the transcript, folds streamed
 * hub events into chat state, and resyncs after reconnects.
 *
 * Expired sessions never connect: their archived transcript is loaded
 * read-only from the history endpoint instead.
 */
export function useCloudChat({
	remoteSessionId,
	expired,
}: {
	remoteSessionId: string;
	expired: boolean;
}): UseCloudChatResult {
	const [connectionState, setConnectionState] =
		useState<CloudConnectionState>("connecting");
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const [chat, setChat] = useState<CloudChatState>(() =>
		createCloudChatState(),
	);
	const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
	const [isHydrating, setIsHydrating] = useState(true);
	const [connectNonce, setConnectNonce] = useState(0);
	const agentSessionIdRef = useRef<string | null>(null);
	// Guards against a stale hydration overwriting state after the user
	// switches sessions or triggers a manual reconnect.
	const hydrationTokenRef = useRef(0);
	// A freshly provisioned sandbox can refuse connections for a short window
	// while it boots; retry a few times before surfacing the error.
	const connectRetriesRef = useRef(0);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const MAX_CONNECT_RETRIES = 4;
	const CONNECT_RETRY_DELAY_MS = 4_000;

	const hydrate = useCallback(async () => {
		const token = ++hydrationTokenRef.current;
		setIsHydrating(true);
		setConnectionError(null);
		try {
			if (expired) {
				const messages = await fetchCloudSessionHistory(remoteSessionId);
				if (hydrationTokenRef.current !== token) {
					return;
				}
				setChat(createCloudChatState(messages));
				setConnectionState("disconnected");
				return;
			}
			setConnectionState("connecting");
			const snapshot = await connectCloudSession(remoteSessionId);
			if (hydrationTokenRef.current !== token) {
				return;
			}
			agentSessionIdRef.current = snapshot.agentSessionId;
			setAgentSessionId(snapshot.agentSessionId);
			setChat(
				createCloudChatState(
					snapshot.messages as ChatMessage[],
					snapshot.agentStatus,
				),
			);
			connectRetriesRef.current = 0;
			setConnectionState("connected");
		} catch (error) {
			if (hydrationTokenRef.current !== token) {
				return;
			}
			if (!expired && connectRetriesRef.current < MAX_CONNECT_RETRIES) {
				connectRetriesRef.current += 1;
				setConnectionState("connecting");
				retryTimerRef.current = setTimeout(() => {
					setConnectNonce((nonce) => nonce + 1);
				}, CONNECT_RETRY_DELAY_MS);
				return;
			}
			setConnectionState("error");
			setConnectionError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			if (hydrationTokenRef.current === token) {
				setIsHydrating(false);
			}
		}
	}, [expired, remoteSessionId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: connectNonce intentionally forces a re-hydration on manual reconnects and bounded retries.
	useEffect(() => {
		void hydrate();
		return () => {
			if (retryTimerRef.current) {
				clearTimeout(retryTimerRef.current);
				retryTimerRef.current = null;
			}
		};
	}, [hydrate, connectNonce]);

	// Live hub events for this remote session.
	useEffect(() => {
		if (expired) {
			return;
		}
		return subscribeCloudSessionEvents(remoteSessionId, {
			onEvent: (event) => {
				if (event.agentSessionId && !agentSessionIdRef.current) {
					agentSessionIdRef.current = event.agentSessionId;
					setAgentSessionId(event.agentSessionId);
				}
				setChat((current) => applyCloudSessionEvent(current, event));
			},
			onConnectionState: (state, error) => {
				setConnectionState(state);
				setConnectionError(error);
			},
			onResync: () => {
				// The sandbox reconnected after a drop: deltas may have been
				// missed, so replace local state with a fresh snapshot.
				void hydrate();
			},
		});
	}, [expired, hydrate, remoteSessionId]);

	// Leave the sandbox connection open on unmount: the session keeps running
	// in the cloud and the sidecar broadcasts progress, so returning to the
	// session stays instant. Connections are pooled per remote session in the
	// sidecar and cleaned up on delete/shutdown.

	const sendPrompt = useCallback(
		async (prompt: string, modelId?: string) => {
			const trimmed = prompt.trim();
			if (!trimmed) {
				return;
			}
			setChat((current) =>
				appendOptimisticUserMessage(
					current,
					trimmed,
					agentSessionIdRef.current,
				),
			);
			try {
				const result = await sendCloudPrompt({
					sessionId: remoteSessionId,
					prompt: trimmed,
					modelId,
				});
				if (result.agentSessionId) {
					agentSessionIdRef.current = result.agentSessionId;
					setAgentSessionId(result.agentSessionId);
				}
			} catch (error) {
				setChat((current) => ({
					...current,
					runStatus: "failed",
					lastError: error instanceof Error ? error.message : String(error),
				}));
				throw error;
			}
		},
		[remoteSessionId],
	);

	const abortRun = useCallback(async () => {
		await abortCloudRun(remoteSessionId);
	}, [remoteSessionId]);

	const respondApproval = useCallback(
		async (approvalId: string, approved: boolean) => {
			// Remove locally right away; approval.resolved confirms it.
			setChat((current) => ({
				...current,
				pendingApprovals: current.pendingApprovals.filter(
					(approval) => approval.requestId !== approvalId,
				),
			}));
			await respondCloudApproval({
				sessionId: remoteSessionId,
				approvalId,
				approved,
			});
		},
		[remoteSessionId],
	);

	const reconnect = useCallback(() => {
		// Force a clean reconnect: drop the pooled sidecar connection first so
		// a half-open socket cannot satisfy the connect call.
		connectRetriesRef.current = 0;
		void disconnectCloudSession(remoteSessionId)
			.catch(() => {})
			.finally(() => {
				setConnectNonce((nonce) => nonce + 1);
			});
	}, [remoteSessionId]);

	return {
		connectionState,
		connectionError,
		chat,
		agentSessionId,
		isHydrating,
		sendPrompt,
		abortRun,
		respondApproval,
		reconnect,
	};
}

// ---------------------------------------------------------------------------
// Event subscription plumbing
// ---------------------------------------------------------------------------

function subscribeCloudSessionEvents(
	remoteSessionId: string,
	handlers: {
		onEvent: (event: CloudSessionEventPayload) => void;
		onConnectionState: (
			state: CloudConnectionState,
			error: string | null,
		) => void;
		onResync: () => void;
	},
): () => void {
	const unsubscribeEvents = desktopClient.subscribe(
		"cloud_session_event",
		(payload) => {
			if (!payload || typeof payload !== "object") {
				return;
			}
			const record = payload as {
				remoteSessionId?: unknown;
				event?: unknown;
				agentSessionId?: unknown;
				payload?: unknown;
			};
			if (record.remoteSessionId !== remoteSessionId) {
				return;
			}
			if (typeof record.event !== "string" || !record.event) {
				return;
			}
			handlers.onEvent({
				event: record.event,
				agentSessionId:
					typeof record.agentSessionId === "string"
						? record.agentSessionId
						: null,
				payload:
					record.payload && typeof record.payload === "object"
						? (record.payload as Record<string, unknown>)
						: null,
			});
		},
	);
	const unsubscribeConnection = desktopClient.subscribe(
		"cloud_session_connection",
		(payload) => {
			if (!payload || typeof payload !== "object") {
				return;
			}
			const record = payload as {
				remoteSessionId?: unknown;
				state?: unknown;
				error?: unknown;
			};
			if (record.remoteSessionId !== remoteSessionId) {
				return;
			}
			if (typeof record.state !== "string") {
				return;
			}
			handlers.onConnectionState(
				record.state as CloudConnectionState,
				typeof record.error === "string" ? record.error : null,
			);
		},
	);
	const unsubscribeResync = desktopClient.subscribe(
		"cloud_session_resync",
		(payload) => {
			if (!payload || typeof payload !== "object") {
				return;
			}
			if (
				(payload as { remoteSessionId?: unknown }).remoteSessionId !==
				remoteSessionId
			) {
				return;
			}
			handlers.onResync();
		},
	);
	return () => {
		unsubscribeEvents();
		unsubscribeConnection();
		unsubscribeResync();
	};
}
