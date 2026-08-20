import type { MessageWithMetadata } from "@cline/shared";

export type PersistedActiveMonitor = { id: string; name: string };

const STARTED_MONITOR = /^Started monitor (mon_\d+) \("(.+)"\):/m;
const MONITOR_RECORD = /^(mon_\d+) \[([^\]]+)] "(.+)":/gm;
const STOPPED_MONITOR = /^Stopped monitor (mon_\d+)\b/gm;
const TERMINAL_MONITOR =
	/\[monitor (mon_\d+) (?:stopped|failed to run:|ended on signal|ended with exit code)/g;
/**
 * Fenced regions carry raw watched-process output. The core sanitizer
 * guarantees a forged close tag cannot appear inside the fence, so stripping
 * whole spans (or an unterminated tail) reliably removes exactly the
 * untrusted text.
 */
const MONITOR_OUTPUT_SPAN = /<monitor-output>[\s\S]*?(?:<\/monitor-output>|$)/g;

type PersistedToolResultBlock = {
	type?: string;
	name?: string;
	content?: unknown;
	is_error?: boolean;
};

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

/**
 * Extracts the string outputs of successful monitor tool calls. Only these
 * may add roster entries: everything else in a transcript — user text, and
 * especially the persisted monitor steer messages whose fenced regions carry
 * raw watched-process output — is untrusted for that purpose, and an
 * unscoped scan would let a printed "Started monitor …" line mint a phantom
 * monitor that later feeds a false resume notice.
 */
function collectMonitorToolResults(message: MessageWithMetadata): string[] {
	if (!Array.isArray(message.content)) return [];
	const results: string[] = [];
	for (const block of message.content as PersistedToolResultBlock[]) {
		if (
			!block ||
			typeof block !== "object" ||
			block.type !== "tool_result" ||
			block.name !== "monitor" ||
			block.is_error
		) {
			continue;
		}
		if (typeof block.content === "string") {
			results.push(block.content);
		}
	}
	return results;
}

/**
 * Reconstruct the monitors that are still running from the durable transcript.
 * Monitor starts and stops are tool results, while natural process exits
 * arrive later as monitor-originated steering messages whose bracketed
 * terminal markers sit outside the untrusted fence.
 */
export function collectPersistedActiveMonitors(
	messages: MessageWithMetadata[],
): PersistedActiveMonitor[] {
	const active = new Map<string, PersistedActiveMonitor>();
	for (const message of messages) {
		for (const result of collectMonitorToolResults(message)) {
			const started = STARTED_MONITOR.exec(result);
			if (started?.[1] && started[2]) {
				active.set(started[1], { id: started[1], name: started[2] });
			}
			// Monitor `list` records refine the status and an explicit `stop`
			// prints "Stopped monitor mon_X" without a bracketed terminal marker.
			for (const match of result.matchAll(MONITOR_RECORD)) {
				const [, id, status, name] = match;
				if (!id || !name) continue;
				if (status === "running") {
					active.set(id, { id, name });
				} else {
					active.delete(id);
				}
			}
			for (const match of result.matchAll(STOPPED_MONITOR)) {
				if (match[1]) active.delete(match[1]);
			}
		}

		// Terminal markers may only remove entries, so scanning message text is
		// safe — but the fenced spans are stripped first so watched-process
		// output cannot suppress a legitimate resume notice either.
		const strings: string[] = [];
		collectStrings(message.content, strings);
		const text = strings.join("\n").replace(MONITOR_OUTPUT_SPAN, "");
		for (const match of text.matchAll(TERMINAL_MONITOR)) {
			if (match[1]) active.delete(match[1]);
		}
	}
	return [...active.values()];
}

/**
 * Monitor names are model-supplied tool input, and the notice embeds them
 * inside a trusted <system-reminder> envelope, so anything tag-shaped must
 * not survive into the composed text.
 */
function sanitizeNoticeName(name: string): string {
	const cleaned = name.replace(/[<>]/g, "").trim();
	return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

export function createMonitorResumeNotice(
	monitors: PersistedActiveMonitor[],
): MessageWithMetadata | undefined {
	if (monitors.length === 0) return undefined;
	const terminalMarkers = monitors
		.map((monitor) => `[monitor ${monitor.id} stopped because session resumed]`)
		.join("\n");
	const names = monitors
		.map((monitor) => `${sanitizeNoticeName(monitor.name)} (${monitor.id})`)
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
