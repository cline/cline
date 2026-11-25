export type CommandCheck =
	| { ok: true }
	| { ok: false; reason: string; code: "forbidden_command" | "invalid_command" };

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{
		pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)*\/(?:\s|$|\*)/,
		reason: "Refusing to delete the filesystem root.",
	},
	{ pattern: /\bmkfs(\.|\s)/i, reason: "Filesystem formatting commands are not permitted." },
	{
		pattern: /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|hd|vd)/i,
		reason: "Raw disk writes are not permitted.",
	},
	{
		pattern: /\b(shutdown|reboot|halt|poweroff)\b/i,
		reason: "Sandbox power commands are not permitted.",
	},
	{
		pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/,
		reason: "Fork bombs are not permitted.",
	},
	{
		pattern: /\bchmod\s+(-[a-zA-Z]+\s+)*(777|a\+rwx)\s+\/(?:\s|$)/i,
		reason: "Refusing to chmod the filesystem root.",
	},
	{
		pattern: /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i,
		reason: "Piping a download directly into a shell is not permitted.",
	},
	{
		pattern: /\/proc\/\d+\/environ|self\/environ/i,
		reason: "Process environment access is not permitted.",
	},
	{ pattern: /\/etc\/(shadow|sudoers)\b/i, reason: "System credential files are off limits." },
	{
		pattern: /\b(?:cat|less|more|head|tail|strings)\b[^\n]*\/root\/\.ssh\b/i,
		reason: "SSH key material is off limits.",
	},
	{
		pattern: /\b(?:kill|pkill|killall)\b[^\n]*\b(?:pid\s*1|init|systemd)\b/i,
		reason: "Refusing to kill the sandbox init process.",
	},
];

export function checkCommand(command: string): CommandCheck {
	const trimmed = command.trim();
	if (trimmed.length === 0)
		return { ok: false, reason: "Command is empty.", code: "invalid_command" };
	if (trimmed.length > 8000) {
		return {
			ok: false,
			reason: "Command exceeds the 8,000 character limit.",
			code: "invalid_command",
		};
	}
	if (trimmed.includes("\0")) {
		return { ok: false, reason: "Command contains a null byte.", code: "invalid_command" };
	}
	for (const rule of FORBIDDEN_PATTERNS) {
		if (rule.pattern.test(trimmed)) {
			return { ok: false, reason: rule.reason, code: "forbidden_command" };
		}
	}
	return { ok: true };
}

export class ForbiddenCommandError extends Error {
	readonly code = "forbidden_command";
	constructor(message: string) {
		super(message);
		this.name = "ForbiddenCommandError";
	}
}

export function assertSafeCommand(command: string): void {
	const result = checkCommand(command);
	if (!result.ok) throw new ForbiddenCommandError(result.reason);
}

/** Single-quote a value for POSIX shells. */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function clampTimeout(seconds: number | undefined, fallback: number, max: number): number {
	if (!Number.isFinite(seconds) || seconds === undefined) return fallback;
	return Math.max(1, Math.min(Math.floor(seconds), max));
}
