import {
	closeSync,
	existsSync,
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

function createDestination(path: string): DestinationStream | undefined {
	try {
		mkdirSync(dirname(path), { recursive: true });
		const fd = openSync(path, "a");
		closeSync(fd);
		if (
			existsSync(path) &&
			Date.now() - statSync(path).mtimeMs >= LOG_MAX_AGE_MS
		) {
			truncateSync(path, 0);
		}
		const destination = pino.destination({
			dest: path,
			mkdir: true,
			sync: true,
		});
		const flushSync = destination.flushSync.bind(destination);
		destination.flushSync = () => {
			try {
				flushSync();
			} catch {
				// The synchronous stream may already be closed during process teardown.
			}
		};
		return destination;
	} catch {
		return undefined;
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
	const destination = runtimeConfig.enabled
		? createDestination(runtimeConfig.destination)
		: undefined;
	const fallback: DestinationStream = {
		write(message: string) {
			process.stderr.write(message);
		},
	};
	const logger = pino(
		{
			name: runtimeConfig.name,
			level: runtimeConfig.enabled ? runtimeConfig.level : "silent",
			enabled: runtimeConfig.enabled,
			timestamp: pino.stdTimeFunctions.isoTime,
		},
		destination ?? fallback,
	).child({ component: "sidecar" });
	let disposed = false;
	const flush = () => {
		try {
			(
				destination as DestinationStream & { flushSync?: () => void }
			)?.flushSync?.();
			logger.flush?.();
		} catch {
			// Logging is best-effort during shutdown.
		}
	};
	return {
		core: createCoreLogger(logger),
		runtimeConfig,
		flush,
		dispose() {
			if (disposed) return;
			disposed = true;
			flush();
			try {
				(destination as DestinationStream & { end?: () => void })?.end?.();
			} catch {
				// Logging is best-effort during shutdown.
			}
		},
	};
}
