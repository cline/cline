import packageJson from "../../package.json";

export type StartupFailure = {
	at: string;
	stage: string;
	attempt: number;
	elapsedMs: number;
	code: string;
};

// Only classify known failures. Arbitrary error messages/stacks can contain
// provider credentials, authenticated endpoints, and user content.
export function startupErrorCode(error: unknown): string {
	const seen = new Set<unknown>();
	for (let depth = 0; error && depth < 5 && !seen.has(error); depth++) {
		seen.add(error);
		if (typeof error !== "object") break;
		const value = error as {
			code?: unknown;
			name?: unknown;
			message?: unknown;
			cause?: unknown;
		};
		if (
			typeof value.code === "string" &&
			["EADDRINUSE", "EACCES", "EPERM", "ECONNREFUSED", "ENOENT"].includes(
				value.code,
			)
		)
			return value.code;
		if (value.name === "HubProbeTimeoutError") return "HUB_PROBE_TIMEOUT";
		if (
			typeof value.message === "string" &&
			/timed out|timeout/i.test(value.message)
		)
			return "STARTUP_TIMEOUT";
		error = value.cause;
	}
	return "INITIALIZATION_FAILED";
}

export function sanitizeStartupLine(value: string): string {
	// Discard the entire sensitive record before truncation, including secrets at
	// the end of oversized lines. No raw logs from sessions are collected.
	if (
		/token|secret|password|authorization|credential|api[_-]?key|bearer|:\/\/|private key|cookie|sk-|eyj/i.test(
			value,
		)
	)
		return "[Sensitive diagnostic omitted]";
	return Array.from(value.replace(/(?:[A-Za-z]:[\\/]|\/)[^\s"'<>]*/g, "[path]"))
		.map((char) =>
			char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char,
		)
		.join("")
		.slice(0, 1024);
}

export type StartupFailureSnapshot = {
	at: string;
	stage: "desktop_endpoint" | "hub";
	elapsedMs: number;
	attempt?: number;
	step?: string;
	code: string;
	exitStatus?: string | null;
	diagnostics: string[];
};

export function buildStartupReport(
	failures: StartupFailureSnapshot[],
	platform: string,
): string {
	return JSON.stringify(
		{
			report: "Cline startup diagnostics",
			schemaVersion: 1,
			appVersion: packageJson.version,
			platform: sanitizeStartupLine(platform),
			failures: failures.slice(-8),
		},
		null,
		2,
	);
}
