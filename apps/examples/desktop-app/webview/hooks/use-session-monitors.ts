"use client";

import { useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

/** One running background monitor shown in the header roster. */
export type SessionMonitor = {
	id: string;
	name: string;
};

/**
 * The roster is stored tagged with the session it belongs to, so a stale one
 * is structurally unreadable rather than something a reset has to remember to
 * clear (mirrors use-session-agents).
 */
type RosterState = {
	sessionId: string | null;
	monitors: SessionMonitor[];
};

const EMPTY_ROSTER: RosterState = { sessionId: null, monitors: [] };

/** Stable identity so consumers memoizing on the roster do not churn. */
const NO_MONITORS: SessionMonitor[] = [];

/** Key used to remember a user-initiated stop until the roster reflects it. */
export function monitorSuppressionKey(
	sessionId: string | undefined,
	monitorId: string,
): string {
	return `${sessionId ?? ""}:${monitorId}`;
}

/**
 * Drops suppression keys whose monitor no longer appears in the live roster.
 *
 * A suppression exists only to bridge the gap between the user's stop and
 * the authoritative monitor_state snapshot removing the entry; once the id
 * is gone the registry has settled the stop. Monitor ids are registry-local
 * (`mon_1` restarts at 1 after every runtime rebuild), so a key kept past
 * that point would permanently hide an unrelated future monitor that happens
 * to reuse the id.
 *
 * Only the displayed session's keys are considered — other sessions' rosters
 * are not in view, so their keys are pruned when they are displayed again.
 * Returns the same set when nothing changed so React state stays stable.
 */
export function pruneMonitorSuppressions(
	suppressed: ReadonlySet<string>,
	activeMonitors: readonly SessionMonitor[],
	sessionId: string | undefined,
): Set<string> {
	if (suppressed.size === 0) {
		return suppressed as Set<string>;
	}
	const prefix = `${sessionId ?? ""}:`;
	const activeIds = new Set(activeMonitors.map((monitor) => monitor.id));
	const next = new Set(suppressed);
	for (const key of suppressed) {
		if (!key.startsWith(prefix)) {
			continue;
		}
		if (!activeIds.has(key.slice(prefix.length))) {
			next.delete(key);
		}
	}
	return next.size === suppressed.size ? (suppressed as Set<string>) : next;
}

/**
 * Keeps only running monitors, validated field by field: snapshots arrive
 * over the transport as untyped JSON.
 */
export function parseRunningMonitors(value: unknown): SessionMonitor[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const running: SessionMonitor[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const record = item as Record<string, unknown>;
		if (record.status !== "running") {
			continue;
		}
		if (typeof record.id !== "string" || typeof record.name !== "string") {
			continue;
		}
		running.push({ id: record.id, name: record.name });
	}
	return running;
}

/**
 * Live roster of the displayed session's background monitors.
 *
 * Fed by `monitor_state` snapshots from the session's monitor registry — the
 * authority on what is actually running — instead of parsing the transcript,
 * which went stale whenever a start record aged out of the display window and
 * could be spoofed by watched-process output. The registry emits an empty
 * snapshot when the session runtime is released, so rosters clear on restarts
 * too. A `list_monitors` read hydrates each newly displayed session, since
 * events only cover changes made while this webview was subscribed.
 */
export function useSessionMonitors(
	sessionId: string | null | undefined,
): SessionMonitor[] {
	const [roster, setRoster] = useState<RosterState>(EMPTY_ROSTER);
	// Only the newest read may write, and any authoritative event outruns
	// every in-flight read: a hydration snapshot resolving late must not
	// overwrite a fresher lifecycle change.
	const requestSeqRef = useRef(0);
	const sessionIdRef = useRef<string | null>(sessionId ?? null);
	sessionIdRef.current = sessionId ?? null;

	useEffect(() => {
		const unsubscribe = desktopClient.subscribe("monitor_state", (payload) => {
			if (!payload || typeof payload !== "object") {
				return;
			}
			const record = payload as { sessionId?: unknown; monitors?: unknown };
			const targetSessionId =
				typeof record.sessionId === "string" ? record.sessionId.trim() : "";
			if (!targetSessionId || targetSessionId !== sessionIdRef.current) {
				return;
			}
			requestSeqRef.current += 1;
			setRoster({
				sessionId: targetSessionId,
				monitors: parseRunningMonitors(record.monitors),
			});
		});
		return () => {
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		if (!sessionId) {
			return;
		}
		requestSeqRef.current += 1;
		const seq = requestSeqRef.current;
		void desktopClient
			.invoke<{ monitors?: unknown }>("list_monitors", { sessionId })
			.then((result) => {
				if (requestSeqRef.current !== seq) {
					return;
				}
				setRoster({
					sessionId,
					monitors: parseRunningMonitors(result?.monitors),
				});
			})
			.catch(() => {
				// A session without a live runtime has no monitors. Show none
				// rather than an error; a later monitor_state event corrects
				// this if a runtime comes up with monitors.
				if (requestSeqRef.current !== seq) {
					return;
				}
				setRoster({ sessionId, monitors: [] });
			});
	}, [sessionId]);

	const isCurrent = sessionId != null && roster.sessionId === sessionId;
	return isCurrent ? roster.monitors : NO_MONITORS;
}
