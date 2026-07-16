import { getShellDisplayName } from "../parse/shell";

export function formatFileContentBlock(path: string, content: string): string {
	return `<file_content path="${path}">\n${content}\n</file_content>`;
}

export function formatUserInputBlock(
	input: string,
	mode: "act" | "plan" | "yolo" = "act",
): string {
	return `<user_input mode="${mode}">${input}</user_input>`;
}

export function formatUserCommandBlock(input: string, slash: string): string {
	return `<user_command slash="${slash}">${input}</user_command>`;
}

// Mirrors exactly what formatUserInputBlock writes (lowercase tag, lowercase
// mode values), but searches rather than anchors: persisted user content can
// carry prepended <mode_notice> elements or trailing attachment blocks
// around the wrapper.
const USER_INPUT_MODE_RE = /<user_input\b[^>]*\bmode="(act|plan|yolo)"/;

/**
 * Recovers the agent mode a persisted user message was sent in from its
 * <user_input mode="..."> wrapper. Returns undefined when the input isn't
 * wrapped (plain text, user_command envelopes, older transcripts).
 */
export function parseUserInputMode(
	input?: string,
): "act" | "plan" | "yolo" | undefined {
	const match = USER_INPUT_MODE_RE.exec(input ?? "");
	return match ? (match[1] as "act" | "plan" | "yolo") : undefined;
}

/**
 * Marks the exact point in the conversation where the user switched between
 * plan and act modes. Prepended to the first user message sent after the
 * switch. It survives normalizeUserInput (so the outbound sanitize in
 * prepareTurnInput delivers it to the model) and is hidden from transcript
 * display by stripRuntimeNotices at display boundaries.
 */
export function formatModeSwitchNotice(
	from: "act" | "plan",
	to: "act" | "plan",
): string {
	return `<mode_notice>The user switched from ${from} mode to ${to} mode before sending this message.</mode_notice>`;
}

/**
 * Marks the point where the user changed the terminal shell that run_commands
 * uses, so the model stops writing commands in the previous shell's syntax.
 * Transcript momentum dominates the (also updated) tool description here:
 * after pages of PowerShell commands the model keeps writing PowerShell
 * unless the change is called out in the conversation itself. Same delivery
 * and display rules as formatModeSwitchNotice.
 */
export function formatShellChangeNotice(
	fromShell: string,
	toShell: string,
): string {
	const from = getShellDisplayName(fromShell);
	const to = getShellDisplayName(toShell);
	return `<environment_notice>The user changed the terminal shell from ${from} to ${to} before sending this message. Commands now run through ${to}; write all subsequent commands in ${to} syntax.</environment_notice>`;
}

export type SwitchNotice<T extends string> = {
	from: T;
	to: T;
};

export type ModeSwitchNotice = SwitchNotice<"act" | "plan">;
export type ShellChangeNotice = SwitchNotice<string>;

/**
 * Tracks a user-initiated setting switch so the next user message can carry a
 * notice marking it. A round trip (a -> b -> a before sending anything)
 * cancels out, since the value the model last saw never effectively changed,
 * and chained switches keep the original starting value.
 */
export function createSwitchNoticeTracker<T extends string>() {
	let pending: SwitchNotice<T> | null = null;
	return {
		record(from: T, to: T): void {
			if (from === to) {
				return;
			}
			if (pending) {
				pending = pending.from === to ? null : { from: pending.from, to };
				return;
			}
			pending = { from, to };
		},
		consume(): SwitchNotice<T> | null {
			const notice = pending;
			pending = null;
			return notice;
		},
	};
}

/**
 * Mode-switch tracker for <mode_notice>. Only UI toggles should be recorded:
 * the model-initiated switch_to_act_mode path already announces itself via
 * the continuation prompt.
 */
export function createModeSwitchNoticeTracker() {
	return createSwitchNoticeTracker<"act" | "plan">();
}

export type ModeSwitchNoticeTracker = ReturnType<
	typeof createModeSwitchNoticeTracker
>;

/** Shell-change tracker for <environment_notice>, over resolved shell paths. */
export function createShellChangeNoticeTracker() {
	return createSwitchNoticeTracker<string>();
}

export type ShellChangeNoticeTracker = ReturnType<
	typeof createShellChangeNoticeTracker
>;

export type UserCommandEnvelope = {
	slash: string;
	content: string;
};

function extractFullTagContent(
	input: string,
	tag: string,
): { attrs: string; content: string } | undefined {
	const trimmed = input.trim();
	const match = new RegExp(
		`^<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>$`,
		"i",
	).exec(trimmed);
	if (!match) {
		return undefined;
	}
	return {
		attrs: match[1] ?? "",
		content: match[2] ?? "",
	};
}

function readAttribute(attrs: string, key: string): string | undefined {
	const match = new RegExp(`${key}="([^"]+)"`, "i").exec(attrs);
	return match?.[1]?.trim() || undefined;
}

export function parseUserCommandEnvelope(
	input?: string,
): UserCommandEnvelope | undefined {
	if (!input?.trim()) {
		return undefined;
	}
	const extracted = extractFullTagContent(input, "user_command");
	if (!extracted) {
		return undefined;
	}
	const slash = readAttribute(extracted.attrs, "slash");
	if (!slash) {
		return undefined;
	}
	return {
		slash,
		content: extracted.content.trim(),
	};
}

export function normalizeUserInput(input?: string): string {
	if (!input?.trim()) return "";
	let next = input.trim();
	for (const tag of ["user_input", "user_command"] as const) {
		const extracted = xmlTagsRemoval(next, tag);
		next = (
			extracted !== next
				? extracted
				: next.replace(new RegExp(`<${tag}[^>]*>`, "g"), "")
		).trim();
	}
	return next;
}

/**
 * Removes runtime-generated notice elements (content included): they are not
 * user-typed text and must not render as such. Deliberately NOT part of
 * normalizeUserInput -- that function also sanitizes outbound prompts before
 * the host wraps them (prepareTurnInput), and stripping there deletes the
 * notices before the model ever sees them.
 */
export function stripRuntimeNotices(input?: string): string {
	if (!input?.trim()) return "";
	return removeTagElements(
		removeTagElements(input, "mode_notice"),
		"environment_notice",
	).trim();
}

// indexOf-based rather than a regex: a lazy dot-all pattern re-scans to the
// end of the string from every unmatched opening tag, which is polynomial on
// adversarial transcript content (CodeQL js/polynomial-redos).
function removeTagElements(input: string, tag: string): string {
	const open = `<${tag}>`;
	const close = `</${tag}>`;
	let result = input;
	let start = result.indexOf(open);
	while (start !== -1) {
		const end = result.indexOf(close, start + open.length);
		if (end === -1) {
			break;
		}
		result = result.slice(0, start) + result.slice(end + close.length);
		start = result.indexOf(open, start);
	}
	return result;
}

export function formatDisplayUserInput(input?: string): string {
	const normalized = stripRuntimeNotices(normalizeUserInput(input));
	const envelope = parseUserCommandEnvelope(input);
	if (!envelope) {
		return normalized;
	}
	if (envelope.slash.toLowerCase() === "team") {
		const prefix = "spawn a team of agents for the following task:";
		const stripped = normalized.toLowerCase().startsWith(prefix)
			? normalized.slice(prefix.length).trim()
			: normalized;
		return stripped ? `/team ${stripped}` : "/team";
	}
	return normalized ? `/${envelope.slash} ${normalized}` : `/${envelope.slash}`;
}

export function xmlTagsRemoval(input?: string, tag?: string): string {
	if (!input?.trim()) return "";
	if (!tag) return input;
	const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
	return input.replace(regex, "$1");
}
