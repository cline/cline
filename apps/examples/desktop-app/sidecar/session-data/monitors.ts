import type { MessageWithMetadata } from "@cline/shared";

export type PersistedActiveMonitor = { id: string; name: string };

const STARTED_MONITOR = /Started monitor (mon_\d+) \("(.+)"\):/g;
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
		},
	};
}
