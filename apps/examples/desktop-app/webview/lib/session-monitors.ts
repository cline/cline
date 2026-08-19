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
const TERMINAL_NOTIFICATION =
	/\[monitor (mon_\d+) (?:stopped|failed to run:|ended on signal|ended with exit code)/g;

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

		for (const match of message.content.matchAll(TERMINAL_NOTIFICATION)) {
			if (match[1]) {
				active.delete(match[1]);
			}
		}
	}

	return [...active.values()];
}
