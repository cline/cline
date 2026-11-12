"use client";

import { buildToolSummary } from "@cline/ui/components/agent-chat/tool-summary";
import { useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

/** The latest thing one watched role session did. */
export type FactoryLiveEntry = {
	/** Human summary of the last tool call, e.g. "Reading src/api/routes.ts". */
	lastTool?: string;
	/** Epoch ms of the last event. */
	at: number;
	ended: boolean;
};

export type FactoryLiveActivity = {
	sessions: ReadonlyMap<string, FactoryLiveEntry>;
	/** False while the desktop transport is reconnecting. */
	connected: boolean;
};

const TERMINAL_STATUSES = new Set([
	"completed",
	"failed",
	"aborted",
	"cancelled",
	"error",
]);

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** "Reading src/api/routes.ts" from a tool name and its input. */
export function describeFactoryTool(
	toolName: string,
	input: unknown,
): string | undefined {
	try {
		const label = buildToolSummary({ toolName, input, inProgress: true })
			.label.replace(/\s+/g, " ")
			.trim();
		return label || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Live activity for Factory role sessions from events the app already
 * receives: `chat_event` tool starts, `chat_session_status` and
 * `chat_session_ended`, plus a `task.factory.activity` event when the engine
 * publishes one. One subscription per mount and no polling; mount it once
 * for every card on screen and pass the result down.
 */
export function useFactoryLiveActivity(
	sessionIds: readonly string[],
): FactoryLiveActivity {
	const key = [...new Set(sessionIds)].sort().join("\n");
	const tracked = useRef(new Set<string>());
	tracked.current = new Set(key ? key.split("\n") : []);
	const [sessions, setSessions] = useState<Map<string, FactoryLiveEntry>>(
		() => new Map(),
	);
	const [connected, setConnected] = useState(true);
	// Forget sessions that are no longer watched.
	useEffect(() => {
		setSessions((current) => {
			const ids = new Set(key ? key.split("\n") : []);
			if ([...current.keys()].every((id) => ids.has(id))) return current;
			return new Map([...current].filter(([id]) => ids.has(id)));
		});
	}, [key]);
	useEffect(() => {
		const update = (
			sessionId: unknown,
			patch: Partial<FactoryLiveEntry> & { at?: number },
		) => {
			if (typeof sessionId !== "string" || !tracked.current.has(sessionId))
				return;
			setSessions((current) => {
				const previous = current.get(sessionId);
				const next = new Map(current);
				next.set(sessionId, {
					...previous,
					...patch,
					at: patch.at ?? Date.now(),
					ended: patch.ended ?? previous?.ended ?? false,
				});
				return next;
			});
		};
		const unsubscribe = [
			desktopClient.subscribe("chat_event", (payload) => {
				const event = record(payload);
				if (event?.stream !== "chat_tool_call_start") return;
				if (typeof event.sessionId !== "string") return;
				if (!tracked.current.has(event.sessionId)) return;
				let chunk: Record<string, unknown> | undefined;
				try {
					chunk = record(JSON.parse(String(event.chunk)));
				} catch {
					return;
				}
				const toolName = chunk?.toolName;
				if (typeof toolName !== "string") return;
				update(event.sessionId, {
					lastTool: describeFactoryTool(toolName, chunk?.input),
					ended: false,
				});
			}),
			desktopClient.subscribe("chat_session_status", (payload) => {
				const event = record(payload);
				if (typeof event?.status !== "string") return;
				update(event.sessionId, {
					ended: TERMINAL_STATUSES.has(event.status),
				});
			}),
			desktopClient.subscribe("chat_session_ended", (payload) => {
				update(record(payload)?.sessionId, { ended: true });
			}),
			// Forward-compatible: the Hub forwards every `task.*` event as is.
			desktopClient.subscribe("task.factory.activity", (payload) => {
				const event = record(payload);
				const at = Date.parse(String(event?.at ?? ""));
				update(event?.sessionId, {
					lastTool:
						typeof event?.summary === "string" && event.summary.trim()
							? event.summary.trim()
							: typeof event?.toolName === "string"
								? describeFactoryTool(event.toolName, event.input)
								: undefined,
					...(Number.isFinite(at) ? { at } : {}),
					ended: false,
				});
			}),
		];
		const unsubscribeTransport = desktopClient.subscribeTransportState(
			(state) => setConnected(state === "connected" || state === "connecting"),
		);
		return () => {
			for (const stop of unsubscribe) stop();
			unsubscribeTransport();
		};
	}, []);
	return { sessions, connected };
}

/**
 * The current time, ticking each second only while `enabled` and the window
 * is visible. Use it for elapsed time; it is the hook's only timer.
 */
export function useFactoryNow(enabled: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!enabled) return;
		let timer: number | undefined;
		const start = () => {
			if (timer !== undefined || document.visibilityState === "hidden") return;
			setNow(Date.now());
			timer = window.setInterval(() => setNow(Date.now()), 1000);
		};
		const stop = () => {
			if (timer !== undefined) window.clearInterval(timer);
			timer = undefined;
		};
		const onVisibility = () =>
			document.visibilityState === "hidden" ? stop() : start();
		start();
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			stop();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [enabled]);
	return now;
}
