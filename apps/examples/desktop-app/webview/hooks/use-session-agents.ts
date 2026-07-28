"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import type { SessionAgentEntry } from "@/lib/session-agents";

/** While a turn runs, child agents come and go faster than a one-shot fetch sees. */
const ACTIVE_POLL_INTERVAL_MS = 2500;

/**
 * The roster is stored tagged with the session it belongs to, so a stale one is
 * structurally unreadable rather than something a reset has to remember to clear.
 */
type RosterState = {
	sessionId: string | null;
	entries: SessionAgentEntry[];
	loading: boolean;
	error: string | null;
};

const EMPTY_ROSTER: RosterState = {
	sessionId: null,
	entries: [],
	loading: false,
	error: null,
};

/** Stable identity so consumers memoizing on `agents` do not churn. */
const NO_AGENTS: SessionAgentEntry[] = [];

function parseAgentEntries(value: unknown): SessionAgentEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const out: SessionAgentEntry[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const record = item as Record<string, unknown>;
		const sessionId =
			typeof record.sessionId === "string" ? record.sessionId : "";
		const agentId = typeof record.agentId === "string" ? record.agentId : "";
		if (!sessionId || !agentId) {
			continue;
		}
		out.push({
			sessionId,
			agentId,
			parentAgentId:
				typeof record.parentAgentId === "string"
					? record.parentAgentId
					: undefined,
			kind: record.kind === "teamtask" ? "teamtask" : "subagent",
			status: typeof record.status === "string" ? record.status : "idle",
			prompt: typeof record.prompt === "string" ? record.prompt : undefined,
			lastAction:
				typeof record.lastAction === "string" ? record.lastAction : undefined,
			teamName:
				typeof record.teamName === "string" ? record.teamName : undefined,
			provider:
				typeof record.provider === "string" ? record.provider : undefined,
			model: typeof record.model === "string" ? record.model : undefined,
			startedAt: typeof record.startedAt === "string" ? record.startedAt : "",
			endedAt: typeof record.endedAt === "string" ? record.endedAt : undefined,
			hasMessages: record.hasMessages === true,
		});
	}
	return out;
}

/**
 * Roster of the child agents a session started, plus on-demand transcript reads.
 *
 * Fetching is driven by `enabled` so the roster is only queried when something
 * is actually showing it — the header pill's popover — and polled while the
 * session is active so a running agent's status settles without user action.
 */
export function useSessionAgents({
	sessionId,
	enabled,
	sessionActive,
}: {
	sessionId: string | null;
	enabled: boolean;
	sessionActive: boolean;
}) {
	const [roster, setRoster] = useState<RosterState>(EMPTY_ROSTER);
	// Guards against a slow response for a previous session overwriting a newer one.
	const requestSessionRef = useRef<string | null>(null);

	const refresh = useCallback(
		async (targetSessionId: string, options?: { quiet?: boolean }) => {
			requestSessionRef.current = targetSessionId;
			if (!options?.quiet) {
				setRoster((prev) =>
					prev.sessionId === targetSessionId
						? { ...prev, loading: true }
						: {
								sessionId: targetSessionId,
								entries: [],
								loading: true,
								error: null,
							},
				);
			}
			try {
				const result = await desktopClient.invoke<unknown>(
					"list_session_agents",
					{ sessionId: targetSessionId },
				);
				if (requestSessionRef.current !== targetSessionId) {
					return;
				}
				setRoster({
					sessionId: targetSessionId,
					entries: parseAgentEntries(result),
					loading: false,
					error: null,
				});
			} catch (err) {
				if (requestSessionRef.current !== targetSessionId) {
					return;
				}
				// A host without this command (or without a session DB) simply has no
				// roster to show; the header still renders its message-derived tally.
				setRoster({
					sessionId: targetSessionId,
					entries: [],
					loading: false,
					error: err instanceof Error ? err.message : "Could not load agents.",
				});
			}
		},
		[],
	);

	// A roster is only ever read back for the session it was fetched for, so
	// switching sessions cannot surface the previous one's agents — there is no
	// reset to forget and no window where stale rows are clickable. That matters
	// because mergeAgentActivity prefers a non-empty roster over the
	// message-derived tally, so a leaked one would render as phantom agents
	// belonging to the new session.
	const isCurrent = sessionId !== null && roster.sessionId === sessionId;
	const agents = isCurrent ? roster.entries : NO_AGENTS;
	const loading = isCurrent && roster.loading;
	const error = isCurrent ? roster.error : null;

	useEffect(() => {
		if (!sessionId || !enabled) {
			return;
		}
		void refresh(sessionId);
		if (!sessionActive) {
			return;
		}
		const timer = window.setInterval(() => {
			void refresh(sessionId, { quiet: true });
		}, ACTIVE_POLL_INTERVAL_MS);
		return () => {
			window.clearInterval(timer);
		};
	}, [enabled, refresh, sessionActive, sessionId]);

	return { agents, loading, error, refresh };
}
