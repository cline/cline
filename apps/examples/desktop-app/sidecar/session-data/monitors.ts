import type { MessageWithMetadata } from "@cline/shared";

export type PersistedActiveMonitor = { id: string; name: string };

const STARTED_MONITOR = /Started monitor (mon_\d+) \("(.+)"\):/g;
const MONITOR_RECORD = /^(mon_\d+) \[([^\]]+)] "(.+)":/gm;
const STOPPED_MONITOR = /^Stopped monitor (mon_\d+)\b/gm;
const TERMINAL_MONITOR =
	/\[monitor (mon_\d+) (?:stopped|failed to run:|ended on signal|ended with exit code)/g;

function collectStrings(value: unknown, output: string[]): void {
	if (typeof value === "string") {
		output.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) collectStrings(entry, output);
		return;
	}
	if (value && typeof value === "object") {
		for (const entry of Object.values(value)) collectStrings(entry, output);
	}
}

export function collectPersistedActiveMonitors(
	messages: MessageWithMetadata[],
): PersistedActiveMonitor[] {
	const active = new Map<string, PersistedActiveMonitor>();
	for (const message of messages) {
		const strings: string[] = [];
		collectStrings(message.content, strings);
		const text = strings.join("\n");
		for (const match of text.matchAll(STARTED_MONITOR)) {
			if (match[1] && match[2]) {
				active.set(match[1], { id: match[1], name: match[2] });
			}
		}
		// Mirror the webview parser (session-monitors.ts): monitor `list`
		// records refine the status and an explicit `stop` prints
		// "Stopped monitor mon_X" without a bracketed terminal marker.
		for (const match of text.matchAll(MONITOR_RECORD)) {
			const [, id, status, name] = match;
			if (!id || !name) continue;
			if (status === "running") {
				active.set(id, { id, name });
			} else {
				active.delete(id);
			}
		}
		for (const match of text.matchAll(STOPPED_MONITOR)) {
			if (match[1]) active.delete(match[1]);
		}
		for (const match of text.matchAll(TERMINAL_MONITOR)) {
			if (match[1]) active.delete(match[1]);
		}
	}
	return [...active.values()];
}

export function createMonitorResumeNotice(
	monitors: PersistedActiveMonitor[],
): MessageWithMetadata | undefined {
	if (monitors.length === 0) return undefined;
	const terminalMarkers = monitors
		.map((monitor) => `[monitor ${monitor.id} stopped because session resumed]`)
		.join("\n");
	const names = monitors
		.map((monitor) => `${monitor.name} (${monitor.id})`)
		.join(", ");
	return {
		role: "user",
		content:
			"<system-reminder>\n" +
			`Resuming this session rebuilt its runtime and stopped ${monitors.length === 1 ? "an active monitor" : "active monitors"}: ${names}. ` +
			"They are no longer running. Tell the user if that affects the current task, and start replacements only if they are still needed and approved.\n" +
			`${terminalMarkers}\n` +
			"</system-reminder>",
		ts: Date.now(),
		metadata: {
			kind: "monitor_resume_notice",
			displayRole: "system",
			reason: "session_resumed",
			// System-injected user-role messages contribute no runs; without
			// this the notice would inflate checkpoint run numbering.
			userRunSpan: 0,
		},
	};
}

export function persistMonitorResumeNotice(
	sessionId: string,
	messages: MessageWithMetadata[],
	persist: (sessionId: string, messages: MessageWithMetadata[]) => void,
): { messages: MessageWithMetadata[]; notice?: MessageWithMetadata } {
	const notice = createMonitorResumeNotice(
		collectPersistedActiveMonitors(messages),
	);
	if (!notice) return { messages };
	const next = [...messages, notice];
	// Resumed sessions do not seed-persist their initial messages. Write the
	// terminal markers before runtime start so a no-turn shutdown cannot lose
	// them and generate the same notice on the next resume.
	persist(sessionId, next);
	return { messages: next, notice };
}
