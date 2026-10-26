/** An ephemeral, owning-session shell environment, never session metadata. */
export type ShellEnvironment = Readonly<Record<string, string>>;

export const MAX_SHELL_ENVIRONMENT_BYTES = 256 * 1024;
const MAX_SHELL_ENVIRONMENT_ENTRIES = 4096;
const INVALID_ENVIRONMENT = "Invalid session shell environment.";

/** Validate untrusted wire input without including names or values in errors. */
export function parseShellEnvironment(
	value: unknown,
): ShellEnvironment | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(INVALID_ENVIRONMENT);
	}
	const entries = Object.entries(value);
	if (entries.length > MAX_SHELL_ENVIRONMENT_ENTRIES) {
		throw new Error(INVALID_ENVIRONMENT);
	}
	const environment: Record<string, string> = Object.create(null);
	let bytes = 0;
	for (const [name, entry] of entries) {
		if (
			!name ||
			name.length > 256 ||
			/[=\0]/.test(name) ||
			typeof entry !== "string" ||
			entry.includes("\0")
		) {
			throw new Error(INVALID_ENVIRONMENT);
		}
		bytes += Buffer.byteLength(name) + Buffer.byteLength(entry) + 2;
		if (bytes > MAX_SHELL_ENVIRONMENT_BYTES) {
			throw new Error(INVALID_ENVIRONMENT);
		}
		environment[name] = entry;
	}
	return Object.freeze(environment);
}

/** Copy at session creation, omitting process.env's unset entries. */
export function captureShellEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
): ShellEnvironment {
	const snapshot = parseShellEnvironment(
		Object.fromEntries(
			Object.entries(environment).filter((entry) => entry[1] !== undefined),
		),
	);
	if (!snapshot) throw new Error(INVALID_ENVIRONMENT);
	return snapshot;
}
