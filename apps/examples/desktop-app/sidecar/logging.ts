import {
	closeSync,
	mkdirSync,
	openSync,
	statSync,
	truncateSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	type BasicLogger,
	type RuntimeLoggerConfig,
	resolveClineDataDir,
} from "@cline/core";
import pino, {
	type DestinationStream,
	type LevelWithSilent,
	type Logger as PinoLogger,
} from "pino";

const LOG_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1_000;
export const DESKTOP_LOG_MAX_BYTES = 50 * 1024 * 1024;
const LOG_LEVELS: ReadonlySet<LevelWithSilent> = new Set([
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"silent",
]);

export interface DesktopLoggerAdapter {
	readonly core: BasicLogger;
	readonly runtimeConfig: Required<RuntimeLoggerConfig>;
	flush(): void;
	dispose(): void;
}

function resolveLogLevel(value: string | undefined): LevelWithSilent {
	const candidate = value?.trim().toLowerCase() as LevelWithSilent | undefined;
	return candidate && LOG_LEVELS.has(candidate) ? candidate : "info";
}

function resolveRuntimeConfig(): Required<RuntimeLoggerConfig> {
	const enabledValue = process.env.CLINE_LOG_ENABLED?.trim().toLowerCase();
	return {
		enabled: enabledValue !== "0" && enabledValue !== "false",
		level: resolveLogLevel(process.env.CLINE_LOG_LEVEL),
		destination:
			process.env.CLINE_LOG_PATH?.trim() ||
			join(resolveClineDataDir(), "logs", "code.log"),
		name: process.env.CLINE_LOG_NAME?.trim() || "cline-code.sidecar",
		bindings: {},
	};
}

type ManagedDestination = DestinationStream & {
	flushSync(): void;
	end(): void;
};

type DestinationResult =
	| { destination: ManagedDestination; error?: never }
	| { destination?: never; error: unknown };

function createDestination(path: string): DestinationResult {
	try {
		mkdirSync(dirname(path), { recursive: true });
		const fd = openSync(path, "a");
		closeSync(fd);
		const initialStats = statSync(path);
		if (
			Date.now() - initialStats.mtimeMs >= LOG_MAX_AGE_MS ||
			initialStats.size >= DESKTOP_LOG_MAX_BYTES
		) {
			truncateSync(path, 0);
		}
		const rawDestination = pino.destination({
			dest: path,
			mkdir: true,
			sync: true,
		});
		const rawFlushSync = rawDestination.flushSync.bind(rawDestination);
		let currentSize = statSync(path).size;
		const destination: ManagedDestination = {
			write(message: string) {
				const messageSize = Buffer.byteLength(message);
				if (currentSize + messageSize > DESKTOP_LOG_MAX_BYTES) {
					try {
						rawFlushSync();
						truncateSync(path, 0);
						currentSize = 0;
					} catch {
						// Rotation is best-effort; preserve the log entry if it fails.
					}
				}
				rawDestination.write(message);
				currentSize += messageSize;
			},
			flushSync() {
				try {
					rawFlushSync();
				} catch {
					// The synchronous stream may already be closed during teardown.
				}
			},
			end() {
				rawDestination.end();
			},
		};
		return { destination };
	} catch (error) {
		return { error };
	}
}

function writeDestinationFallbackWarning(path: string, error: unknown): void {
	try {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(
			`[cline-code] Unable to open log file ${path}; falling back to stderr (${message})\n`,
		);
	} catch {
		// The fallback warning must never prevent sidecar startup.
	}
}

function flushDestination(destination: ManagedDestination | undefined): void {
	if (!destination) return;
	try {
		destination.flushSync();
	} catch {
		// Logging is best-effort during shutdown.
	}
}

function closeDestination(destination: ManagedDestination | undefined): void {
	if (!destination) return;
	try {
		destination.end();
	} catch {
		// Logging is best-effort during shutdown.
	}
}

function createFallbackDestination(): DestinationStream {
	return {
		write(message: string) {
			process.stderr.write(message);
		},
	};
}

/*
	The adapter intentionally owns the destination lifecycle. Pino receives a
	synchronous stream so telemetry and fatal-process logs can be flushed before
	the sidecar exits.
*/
function createPinoLogger(
	runtimeConfig: Required<RuntimeLoggerConfig>,
	destination: ManagedDestination | undefined,
): PinoLogger {
	return pino(
		{
			name: runtimeConfig.name,
			level: runtimeConfig.enabled ? runtimeConfig.level : "silent",
			enabled: runtimeConfig.enabled,
			timestamp: pino.stdTimeFunctions.isoTime,
		},
		destination ?? createFallbackDestination(),
	).child({ component: "sidecar" });
}

function flushLogger(logger: PinoLogger): void {
	try {
		logger.flush?.();
	} catch {
		// Logging is best-effort during shutdown.
	}
}

function toFields(
	metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (!metadata) return undefined;
	const { error, ...rest } = metadata;
	const fields = error === undefined ? rest : { ...rest, err: error };
	return Object.keys(fields).length > 0 ? fields : undefined;
}

function createCoreLogger(logger: PinoLogger): BasicLogger {
	return {
		debug(message, metadata) {
			const fields = toFields(metadata);
			fields ? logger.debug(fields, message) : logger.debug(message);
		},
		log(message, metadata) {
			const fields = toFields(metadata);
			const write =
				metadata?.severity === "error"
					? logger.error
					: metadata?.severity === "warn"
						? logger.warn
						: logger.info;
			fields
				? write.call(logger, fields, message)
				: write.call(logger, message);
		},
		error(message, metadata) {
			const fields = toFields(metadata);
			fields ? logger.error(fields, message) : logger.error(message);
		},
	};
}

export function createDesktopLoggerAdapter(): DesktopLoggerAdapter {
	const runtimeConfig = resolveRuntimeConfig();
	const destinationResult = runtimeConfig.enabled
		? createDestination(runtimeConfig.destination)
		: undefined;
	const destination = destinationResult?.destination;
	if (destinationResult?.error !== undefined) {
		writeDestinationFallbackWarning(
			runtimeConfig.destination,
			destinationResult.error,
		);
	}
	const logger = createPinoLogger(runtimeConfig, destination);
	let disposed = false;
	const flush = () => {
		flushDestination(destination);
		flushLogger(logger);
	};
	return {
		core: createCoreLogger(logger),
		runtimeConfig,
		flush,
		dispose() {
			if (disposed) return;
			disposed = true;
			flush();
			closeDestination(destination);
		},
	};
}
