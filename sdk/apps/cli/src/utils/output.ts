import { appendFileSync } from "node:fs";
import { nowIso } from "./helpers";
import type { ActiveCliSession, CliOutputMode } from "./types";

// =============================================================================
// ANSI Colors (no dependencies for speed)
// =============================================================================

export const c = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	gray: "\x1b[90m",
};

// =============================================================================
// Shared mutable state for output
// =============================================================================

let currentOutputMode: CliOutputMode = "text";
let activeCliSession: ActiveCliSession | undefined;

export function setCurrentOutputMode(mode: CliOutputMode): void {
	currentOutputMode = mode;
}

export function getCurrentOutputMode(): CliOutputMode {
	return currentOutputMode;
}

export function setActiveCliSession(
	session: ActiveCliSession | undefined,
): void {
	activeCliSession = session;
}

export function getActiveCliSession(): ActiveCliSession | undefined {
	return activeCliSession;
}

// =============================================================================
// Stream error guards
// =============================================================================

let streamErrorGuardsBound = false;

export function isBrokenPipeError(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			"code" in error &&
			typeof (error as { code?: unknown }).code === "string" &&
			(error as { code: string }).code === "EPIPE",
	);
}

export function installStreamErrorGuards(): void {
	if (streamErrorGuardsBound) {
		return;
	}
	streamErrorGuardsBound = true;

	const onStdoutError = (error: unknown) => {
		if (isBrokenPipeError(error)) {
			process.exit(0);
		}
	};
	const onStderrError = (error: unknown) => {
		if (isBrokenPipeError(error)) {
			process.exit(0);
		}
	};

	process.stdout.on("error", onStdoutError);
	process.stderr.on("error", onStderrError);
}

// =============================================================================
// CLI Output
// =============================================================================

function jsonReplacer(_key: string, value: unknown): unknown {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
		};
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	return value;
}

export function emitJsonLine(
	stream: "stdout" | "stderr",
	record: Record<string, unknown>,
): void {
	const line = `${JSON.stringify(
		{
			ts: nowIso(),
			...record,
		},
		jsonReplacer,
	)}\n`;
	try {
		if (stream === "stdout") {
			process.stdout.write(line);
		} else {
			process.stderr.write(line);
		}
	} catch (error) {
		if (!isBrokenPipeError(error)) {
			throw error;
		}
	}
	if (activeCliSession) {
		try {
			appendFileSync(activeCliSession.transcriptPath, line, "utf8");
		} catch {
			// Best-effort transcript persistence for desktop discovery.
		}
	}
}

export function write(text: string): void {
	try {
		process.stdout.write(text);
	} catch (error) {
		if (!isBrokenPipeError(error)) {
			throw error;
		}
	}
	if (activeCliSession) {
		try {
			appendFileSync(activeCliSession.transcriptPath, text, "utf8");
		} catch {
			// Best-effort transcript persistence for desktop discovery.
		}
	}
}

export function writeln(text = ""): void {
	if (currentOutputMode === "json") {
		return;
	}
	write(`${text}\n`);
}

export function writeErr(text: string): void {
	if (currentOutputMode === "json") {
		emitJsonLine("stderr", { type: "error", message: text });
		return;
	}
	console.error(`${c.red}error:${c.reset} ${text}`);
	if (activeCliSession) {
		try {
			appendFileSync(
				activeCliSession.transcriptPath,
				`error: ${text}\n`,
				"utf8",
			);
		} catch {
			// Best-effort transcript persistence for desktop discovery.
		}
	}
}

// =============================================================================
// Formatting helpers
// =============================================================================

export function formatUsd(value: number, fixed = 6): string {
	if (!Number.isFinite(value) || value <= 0) {
		return "$0.00";
	}
	if (value >= 1) {
		return `$${value.toFixed(fixed)}`;
	}
	if (value >= 0.01) {
		return `$${value.toFixed(fixed)}`;
	}
	return `$${value.toFixed(fixed)}`;
}

export function formatCreditBalance(value: number): string {
	if (!Number.isFinite(value)) {
		return "$0";
	}
	if (Number.isInteger(value)) {
		return `$${value}`;
	}
	return `$${value.toFixed(4).replace(/\.?0+$/, "")}`;
}

export function normalizeCreditBalance(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	// Cline account APIs may return raw integer micro-credit units.
	if (Number.isInteger(value) && Math.abs(value) >= 1_000_000) {
		return value / 1_000_000;
	}
	return value;
}
