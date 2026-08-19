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
 * Roster of the child agents a session started.
 *
 * Read once per displayed session and then polled only while that session is
 * active. Deliberately *not* gated on whether the header is currently showing
 * any agents: that tally is derived from the newest messages only, so gating on
 * it would deadlock — a session whose spawn calls have aged out of the message
 * window would report zero agents, never query the database that still
 * remembers them, and so never have anything to display. Polling is the only
 * part worth gating, since it is the only part that costs anything repeatedly.
 */
export function useSessionAgents({
	sessionId,
	sessionActive,
	panelOpen = false,
}: {
	sessionId: string | null;
	sessionActive: boolean;
	/** Re-reads when the roster is put on screen; never gates the first read. */
	panelOpen?: boolean;
}) {
	const [roster, setRoster] = useState<RosterState>(EMPTY_ROSTER);
	// Only the newest read may write. Comparing session ids is not enough: two
	// reads for the *same* session can overlap — a poll tick alongside an
	// on-open or turn-finished read, and `list_session_agents` opens one
	// transcript per child, so it can outlast the poll interval. Both would pass
	// a session-id check, letting whichever arrives last win regardless of which
	// was issued last, so a stale snapshot could revert completed agents to
	// running or drop ones already discovered.
	const requestSeqRef = useRef(0);

	const refresh = useCallback(
		async (targetSessionId: string, options?: { quiet?: boolean }) => {
			requestSeqRef.current += 1;
			const seq = requestSeqRef.current;
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
				if (requestSeqRef.current !== seq) {
					return;
				}
				setRoster({
					sessionId: targetSessionId,
					entries: parseAgentEntries(result),
					loading: false,
					error: null,
				});
			} catch (err) {
				if (requestSeqRef.current !== seq) {
					return;
				}
				const message =
					err instanceof Error ? err.message : "Could not load agents.";
				setRoster((prev) => ({
					sessionId: targetSessionId,
					// A failed read means this attempt learned nothing — not that the
					// agents are gone. Discarding them would blank a list that had
					// loaded fine, and because the sequence guard drops any older
					// in-flight response there would be nothing left to restore it: on
					// an idle session nothing polls, and if the roster was the only
					// source of agents the pill itself disappears, taking away the
					// popover that would have triggered a re-read.
					//
					// Entries from a *different* session are still dropped, so a failure
					// cannot make the previous session's agents surface under this one.
					entries: prev.sessionId === targetSessionId ? prev.entries : [],
					loading: false,
					error: message,
				}));
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

	// One read per displayed session, repeated when the session starts or stops
	// running — a turn can finish up to a poll interval after the last read, so
	// this is what settles the final statuses. A read for a session mid-turn is
	// quiet because its list is already on screen; the first read of a session
	// that is sitting idle is the one worth showing a spinner for.
	useEffect(() => {
		if (!sessionId) {
			return;
		}
		void refresh(sessionId, { quiet: sessionActive });
	}, [refresh, sessionActive, sessionId]);

	// Opening the panel is the moment the roster is actually read, so re-read it
	// then. Quiet, because the list is already on screen.
	useEffect(() => {
		if (!sessionId || !panelOpen) {
			return;
		}
		void refresh(sessionId, { quiet: true });
	}, [panelOpen, refresh, sessionId]);

	useEffect(() => {
		if (!sessionId || !sessionActive) {
			return;
		}
		const timer = window.setInterval(() => {
			void refresh(sessionId, { quiet: true });
		}, ACTIVE_POLL_INTERVAL_MS);
		return () => {
			window.clearInterval(timer);
		};
	}, [refresh, sessionActive, sessionId]);

	return { agents, loading, error, refresh };
}
