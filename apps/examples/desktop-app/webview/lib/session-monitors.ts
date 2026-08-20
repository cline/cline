import type { ChatMessage } from "@/lib/chat-schema";

export type SessionMonitor = {
	id: string;
	name: string;
};

type MonitorToolPayload = {
	toolName?: string;
	result?: unknown;
	isError?: boolean;
};

const STARTED_MONITOR = /^Started monitor (mon_\d+) \("(.+)"\):/m;
const MONITOR_RECORD = /^(mon_\d+) \[([^\]]+)] "(.+)":/gm;
/**
 * Only complete, line-anchored terminal markers may remove a monitor. The
 * previous prefix-anywhere match let ordinary prose mentioning a marker (or a
 * watched process printing one) hide a monitor that was still running.
 */
const TERMINAL_NOTIFICATION =
	/^\[monitor (mon_\d+) (?:stopped(?: by the user| because session resumed)?|failed to run: [^\n]*|ended on signal [A-Za-z0-9]+|ended with exit code -?\d+)\]$/gm;
/**
 * Fenced regions carry raw watched-process output. The core sanitizer
 * guarantees a forged close tag cannot appear inside the fence, so stripping
 * whole spans (or an unterminated tail) removes exactly the untrusted text —
 * a live process printing a terminal marker must not hide its own monitor.
 */
const MONITOR_OUTPUT_SPAN = /<monitor-output>[\s\S]*?(?:<\/monitor-output>|$)/g;

function parseToolPayload(
	message: ChatMessage,
): MonitorToolPayload | undefined {
	try {
		return JSON.parse(message.content) as MonitorToolPayload;
	} catch {
		return undefined;
	}
}

/**
 * Reconstruct the monitors that are still running from the durable transcript.
 * Monitor starts and stops are tool results, while natural process exits arrive
 * later as monitor-originated steering messages.
 */
export function buildActiveSessionMonitors(
	messages: ChatMessage[],
): SessionMonitor[] {
	const active = new Map<string, SessionMonitor>();

	for (const message of messages) {
		if (message.role === "tool") {
			const payload = parseToolPayload(message);
			const toolName = (message.meta?.toolName ?? payload?.toolName)
				?.trim()
				.toLowerCase();
			if (toolName !== "monitor" || payload?.isError) {
				continue;
			}
			const result =
				typeof payload?.result === "string"
					? payload.result
					: message.meta?.toolOutput;
			if (!result) {
				continue;
			}

			const started = STARTED_MONITOR.exec(result);
			if (started?.[1] && started[2]) {
				active.set(started[1], { id: started[1], name: started[2] });
			}

			for (const match of result.matchAll(MONITOR_RECORD)) {
				const [, id, status, name] = match;
				if (!id || !name) {
					continue;
				}
				if (status === "running") {
					active.set(id, { id, name });
				} else {
					active.delete(id);
				}
			}

			const stopped = /^Stopped monitor (mon_\d+)\b/m.exec(result)?.[1];
			if (stopped) {
				active.delete(stopped);
			}
			continue;
		}

		const outsideFences = message.content.replace(MONITOR_OUTPUT_SPAN, "");
		for (const match of outsideFences.matchAll(TERMINAL_NOTIFICATION)) {
			if (match[1]) {
				active.delete(match[1]);
			}
		}
	}

	return [...active.values()];
}

/** Key used to remember a user-initiated stop until the transcript reflects it. */
export function monitorSuppressionKey(
	sessionId: string | undefined,
	monitorId: string,
): string {
	return `${sessionId ?? ""}:${monitorId}`;
}

/**
 * Drops suppression keys whose monitor no longer appears in the parsed roster.
 *
 * A suppression exists only to bridge the gap between the user's stop and its
 * terminal marker landing in the transcript; once the id is gone the marker
 * has landed. Monitor ids are registry-local (`mon_1` restarts at 1 after
 * every runtime rebuild), so a key kept past that point would permanently
 * hide an unrelated future monitor that happens to reuse the id.
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
