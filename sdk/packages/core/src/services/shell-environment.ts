/** An ephemeral, owning-session shell environment, never session metadata. */
export type ShellEnvironment = Readonly<Record<string, string>>;

export const MAX_SHELL_ENVIRONMENT_BYTES = 256 * 1024;
const MAX_SHELL_ENVIRONMENT_ENTRIES = 4096;

/** Constant per failure class: never include a variable name or value. */
export const SHELL_ENVIRONMENT_ERRORS = {
	object: "Session shell environment must be an object.",
	count: "Session shell environment has too many entries.",
	name: "Session shell environment has an invalid variable name.",
	value: "Session shell environment has an invalid variable value.",
	bytes: "Session shell environment exceeds 256 KiB.",
} as const;

/** Validate untrusted wire input without including names or values in errors. */
export function parseShellEnvironment(
	value: unknown,
): ShellEnvironment | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(SHELL_ENVIRONMENT_ERRORS.object);
	}
	const entries = Object.entries(value);
	if (entries.length > MAX_SHELL_ENVIRONMENT_ENTRIES) {
		throw new Error(SHELL_ENVIRONMENT_ERRORS.count);
	}
	const environment: Record<string, string> = Object.create(null);
	let bytes = 0;
	for (const [name, entry] of entries) {
		if (!name || name.length > 256 || /[=\0]/.test(name)) {
			throw new Error(SHELL_ENVIRONMENT_ERRORS.name);
		}
		if (typeof entry !== "string" || entry.includes("\0")) {
			throw new Error(SHELL_ENVIRONMENT_ERRORS.value);
		}
		bytes += Buffer.byteLength(name) + Buffer.byteLength(entry) + 2;
		if (bytes > MAX_SHELL_ENVIRONMENT_BYTES) {
			throw new Error(SHELL_ENVIRONMENT_ERRORS.bytes);
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
	if (!snapshot) throw new Error(SHELL_ENVIRONMENT_ERRORS.object);
	return snapshot;
}
