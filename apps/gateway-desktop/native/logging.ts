/**
 * Structured, redacted broker logging.
 *
 * JSONL to a per-launch file under the app data directory plus mirrored
 * one-line summaries on stderr. Values under secret-shaped keys are
 * redacted before serialization — the bridge secret and the Gateway
 * per-instance auth token must never reach disk or stdout.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SECRET_KEY_PATTERN = /secret|auth|token|password|credential|key$/i;
const MAX_VALUE_LENGTH = 2_000;

export function redactForLogging(value: unknown, depth = 0): unknown {
	if (depth > 6) {
		return "[depth]";
	}
	if (typeof value === "string") {
		return value.length > MAX_VALUE_LENGTH
			? `${value.slice(0, MAX_VALUE_LENGTH)}…[truncated]`
			: value;
	}
	if (typeof value !== "object" || value === null) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.slice(0, 50).map((entry) => redactForLogging(entry, depth + 1));
	}
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		out[key] = SECRET_KEY_PATTERN.test(key)
			? "[redacted]"
			: redactForLogging(entry, depth + 1);
	}
	return out;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
	log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
	info(event: string, fields?: Record<string, unknown>): void;
	warn(event: string, fields?: Record<string, unknown>): void;
	error(event: string, fields?: Record<string, unknown>): void;
	readonly logDir: string;
}

export function createLogger(logDir: string): Logger {
	mkdirSync(logDir, { recursive: true, mode: 0o700 });
	const logFile = join(
		logDir,
		`broker-${new Date().toISOString().slice(0, 10)}.jsonl`,
	);
	const log = (
		level: LogLevel,
		event: string,
		fields?: Record<string, unknown>,
	) => {
		const entry = {
			at: new Date().toISOString(),
			level,
			event,
			...(fields ? (redactForLogging(fields) as Record<string, unknown>) : {}),
		};
		try {
			appendFileSync(logFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
		} catch {
			// Diagnostics must never take the broker down.
		}
		if (level !== "debug") {
			process.stderr.write(`[gateway-desktop] ${level} ${event}\n`);
		}
	};
	return {
		log,
		info: (event, fields) => log("info", event, fields),
		warn: (event, fields) => log("warn", event, fields),
		error: (event, fields) => log("error", event, fields),
		logDir,
	};
}

/** No-op logger for tests. */
export function createNullLogger(): Logger {
	const noop = () => {};
	return {
		log: noop,
		info: noop,
		warn: noop,
		error: noop,
		logDir: "",
	};
}
