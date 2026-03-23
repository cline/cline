import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	statSync,
	truncateSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { BasicLogger, RpcChatRuntimeLoggerConfig } from "@clinebot/core";
import { resolveClineDataDir } from "@clinebot/core";
import pino, {
	type DestinationStream,
	type LevelWithSilent,
	type Logger as PinoLogger,
} from "pino";
import { getCliBuildInfo } from "../utils/common";

const loggerCache = new Map<
	string,
	{ logger: PinoLogger; destination?: DestinationStream }
>();
const cleanupTimersByDestination = new Map<string, NodeJS.Timeout>();
const LOG_CLEANUP_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;

export interface CliLoggerAdapter {
	readonly pino: PinoLogger;
	readonly core: BasicLogger;
	readonly runtimeConfig: RpcChatRuntimeLoggerConfig;
	child(bindings: Record<string, unknown>): CliLoggerAdapter;
}

interface CreateCliLoggerAdapterInput {
	runtime: "cli" | "rpc-runtime";
	component?: string;
	runtimeConfig?: RpcChatRuntimeLoggerConfig;
}

const LOG_LEVELS: ReadonlySet<LevelWithSilent> = new Set([
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"silent",
]);

function normalizeLogLevel(value: string | undefined): LevelWithSilent {
	const candidate = value?.trim().toLowerCase() as LevelWithSilent | undefined;
	if (!candidate || !LOG_LEVELS.has(candidate)) {
		return "info";
	}
	return candidate;
}

function normalizeRuntimeConfig(input: {
	runtime: "cli" | "rpc-runtime";
	runtimeConfig?: RpcChatRuntimeLoggerConfig;
}): Required<RpcChatRuntimeLoggerConfig> {
	const base = input.runtimeConfig;
	const defaultDestination = join(
		resolveClineDataDir(),
		"logs",
		`${getCliBuildInfo().name}.log`,
	);
	const enabledEnv = process.env.CLINE_LOG_ENABLED?.trim();
	const enabled =
		base?.enabled ??
		!(enabledEnv === "0" || enabledEnv?.toLowerCase() === "false");
	const level = normalizeLogLevel(base?.level ?? process.env.CLINE_LOG_LEVEL);
	const destination =
		base?.destination?.trim() ||
		process.env.CLINE_LOG_PATH?.trim() ||
		defaultDestination;
	const name =
		base?.name?.trim() ||
		process.env.CLINE_LOG_NAME?.trim() ||
		`${getCliBuildInfo().name}.${input.runtime}`;
	const bindings = base?.bindings ?? {};

	return {
		enabled,
		level,
		destination,
		name,
		bindings,
	};
}

function getOrCreatePinoLogger(
	config: Required<RpcChatRuntimeLoggerConfig>,
	runtime: "cli" | "rpc-runtime",
): PinoLogger {
	if (!config.enabled) {
		return pino({
			name: config.name,
			level: "silent",
			enabled: false,
			timestamp: pino.stdTimeFunctions.isoTime,
		});
	}
	const key = `${runtime}|${config.enabled}|${config.level}|${config.destination}|${config.name}`;
	const cached = loggerCache.get(key);
	if (cached) {
		return cached.logger;
	}

	const destination = createWritableDestination(config.destination, runtime);
	if (destination) {
		cleanupStaleLogFile(config.destination);
		startLogCleanupTimer(config.destination);
	}
	const created = pino(
		{
			name: config.name,
			level: config.level,
			timestamp: pino.stdTimeFunctions.isoTime,
			enabled: config.enabled,
		},
		destination ?? pino.destination(2),
	);
	loggerCache.set(key, { logger: created, destination });
	return created;
}

function createWritableDestination(
	destinationPath: string,
	runtime: "cli" | "rpc-runtime",
): DestinationStream | undefined {
	try {
		mkdirSync(dirname(destinationPath), { recursive: true });
		const fd = openSync(destinationPath, "a");
		closeSync(fd);
		const dest = pino.destination({
			dest: destinationPath,
			mkdir: true,
			sync: runtime === "cli",
		});
		// SonicBoom registers its own process 'exit' handler that calls
		// flushSync().  When the process exits before the async stream is
		// ready (e.g. --help, --version) that handler throws
		// "sonic boom is not ready yet".  Wrap flushSync so it silently
		// no-ops instead of throwing.
		const origFlushSync = dest.flushSync.bind(dest);
		dest.flushSync = () => {
			try {
				origFlushSync();
			} catch {
				// Best-effort: stream not ready or already closed.
			}
		};
		return dest;
	} catch {
		return undefined;
	}
}

function cleanupStaleLogFile(destination: string): void {
	if (!existsSync(destination)) {
		return;
	}
	try {
		const stats = statSync(destination);
		const ageMs = Date.now() - stats.mtimeMs;
		if (ageMs >= LOG_CLEANUP_INTERVAL_MS) {
			truncateSync(destination, 0);
		}
	} catch {
		// no-op: cleanup is best-effort.
	}
}

function startLogCleanupTimer(destination: string): void {
	if (cleanupTimersByDestination.has(destination)) {
		return;
	}
	const timer = setInterval(() => {
		try {
			truncateSync(destination, 0);
		} catch {
			// no-op: cleanup is best-effort.
		}
	}, LOG_CLEANUP_INTERVAL_MS);
	timer.unref();
	cleanupTimersByDestination.set(destination, timer);
}

function toPinoFields(
	metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (!metadata) {
		return undefined;
	}
	const { error, ...rest } = metadata;
	if (error === undefined) {
		return Object.keys(rest).length > 0 ? rest : undefined;
	}
	const fields: Record<string, unknown> = { ...rest, err: error };
	return fields;
}

function createCoreLogger(logger: PinoLogger): BasicLogger {
	return {
		debug: (message, metadata) => {
			const fields = toPinoFields(metadata);
			if (fields) {
				logger.debug(fields, message);
				return;
			}
			logger.debug(message);
		},
		info: (message, metadata) => {
			const fields = toPinoFields(metadata);
			if (fields) {
				logger.info(fields, message);
				return;
			}
			logger.info(message);
		},
		warn: (message, metadata) => {
			const fields = toPinoFields(metadata);
			if (fields) {
				logger.warn(fields, message);
				return;
			}
			logger.warn(message);
		},
		error: (message, metadata) => {
			const fields = toPinoFields(metadata);
			if (fields) {
				logger.error(fields, message);
				return;
			}
			logger.error(message);
		},
	};
}

function createAdapterFromPino(
	logger: PinoLogger,
	runtimeConfig: Required<RpcChatRuntimeLoggerConfig>,
): CliLoggerAdapter {
	return {
		pino: logger,
		core: createCoreLogger(logger),
		runtimeConfig,
		child: (bindings) =>
			createAdapterFromPino(logger.child(bindings), runtimeConfig),
	};
}

export function createCliLoggerAdapter(
	input: CreateCliLoggerAdapterInput,
): CliLoggerAdapter {
	const runtimeConfig = normalizeRuntimeConfig({
		runtime: input.runtime,
		runtimeConfig: input.runtimeConfig,
	});
	const baseLogger = getOrCreatePinoLogger(runtimeConfig, input.runtime);
	const logger = baseLogger.child({
		...runtimeConfig.bindings,
		...(input.component ? { component: input.component } : {}),
	});
	return createAdapterFromPino(logger, runtimeConfig);
}

export function flushCliLoggerAdapters(): void {
	for (const { logger, destination } of loggerCache.values()) {
		try {
			const syncFlusher = destination as DestinationStream & {
				flushSync?: () => void;
			};
			if (syncFlusher && typeof syncFlusher.flushSync === "function") {
				syncFlusher.flushSync();
				continue;
			}
			if (typeof logger.flush === "function") {
				logger.flush();
			}
		} catch {
			// no-op: shutdown flush is best-effort.
		}
	}
}
