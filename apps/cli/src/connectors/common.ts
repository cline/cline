import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	linkSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { HubSessionClient, HubSessionRow } from "@cline/core";
import {
	ensureParentDir,
	getProcessStartToken,
	resolveClineDataDir,
} from "@cline/core";
import {
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	withResolvedClineBuildEnv,
} from "@cline/shared";
import { createCliLoggerAdapter } from "../logging/adapter";
import { logSpawnedProcess } from "../logging/process";
import { resolveCliLaunchSpec } from "../utils/internal-launch";

export const CLINE_CONNECTOR_DETACHED_CHILD_ENV =
	"CLINE_CONNECTOR_DETACHED_CHILD";

/**
 * Internal success from a detached connect when an instance is already running.
 * `runConnectAdapter` maps this to exit 0 without changing persisted autostart
 * state.
 */
export const CONNECT_ALREADY_RUNNING_EXIT_CODE = 75;

/** Rotate a detached connector log once it passes this size. */
const DETACHED_LOG_MAX_BYTES = 8 * 1024 * 1024;

export function parseBooleanFlag(rawArgs: string[], flag: string): boolean {
	return rawArgs.includes(flag);
}

export function parseStringFlag(
	rawArgs: string[],
	shortFlag: string,
	longFlag: string,
): string | undefined {
	for (let index = 0; index < rawArgs.length; index += 1) {
		const value = rawArgs[index];
		if (value !== shortFlag && value !== longFlag) {
			continue;
		}
		const next = rawArgs[index + 1]?.trim();
		return next ? next : undefined;
	}
	return undefined;
}

export function parseIntegerFlag(
	rawArgs: string[],
	shortFlag: string,
	longFlag: string,
): number | undefined {
	const raw = parseStringFlag(rawArgs, shortFlag, longFlag);
	if (!raw) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function isProcessRunning(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

type ProcessProbe = {
	isRunning: (pid: number) => boolean;
	getStartToken: (pid: number) => string | undefined;
};

const defaultProcessProbe: ProcessProbe = {
	isRunning: isProcessRunning,
	getStartToken: getProcessStartToken,
};

export async function terminateProcess(pid: number): Promise<boolean> {
	if (!isProcessRunning(pid)) {
		return false;
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return false;
	}
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (!isProcessRunning(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		return false;
	}
	for (let attempt = 0; attempt < 10; attempt += 1) {
		if (!isProcessRunning(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return !isProcessRunning(pid);
}

function buildDetachedConnectorArgs(
	commandPrefixArgs: string[],
	rawArgs: string[],
): string[] {
	return [...commandPrefixArgs, ...rawArgs, "-i"];
}

function buildDetachedConnectorCommand(
	commandPrefixArgs: string[],
	rawArgs: string[],
	execPath = process.execPath,
	entryArg = process.argv[1],
	execArgv = process.execArgv,
	cwd = process.cwd(),
	env = process.env,
): { launcher: string; childArgs: string[] } | undefined {
	const spec = resolveCliLaunchSpec({
		execPath,
		argv: [process.argv[0] || "node", entryArg ?? ""],
		execArgv,
		cwd,
		env,
		debugRole: "connector",
	});
	if (!spec) {
		return undefined;
	}
	const commandArgs = buildDetachedConnectorArgs(commandPrefixArgs, rawArgs);
	return {
		launcher: spec.launcher,
		childArgs: [...spec.childArgsPrefix, ...commandArgs],
	};
}

function buildDetachedConnectorEnv(
	childEnvKey: string,
	env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const childEnv = {
		...withResolvedClineBuildEnv(env),
		[childEnvKey]: "1",
		[CLINE_CONNECTOR_DETACHED_CHILD_ENV]: "1",
	};
	delete childEnv[CLINE_RUN_AS_HUB_DAEMON_ENV];
	return childEnv;
}

export function resolveConnectorDebugLogPath(
	adapterName: string,
	instanceKey: string,
): string {
	const safeAdapter = adapterName.replace(/[^a-zA-Z0-9._-]+/g, "_");
	const safeKey = instanceKey.replace(/[^a-zA-Z0-9._-]+/g, "_");
	return join(
		resolveClineDataDir(),
		"logs",
		"connectors",
		safeAdapter,
		`${safeKey}.log`,
	);
}

/**
 * Connectors are long-lived and restart often, so an append-only log would grow
 * without bound on a host that runs them for weeks. Keep one previous
 * generation and start fresh once the current one gets large.
 */
function rotateOversizedLog(path: string): void {
	try {
		if (statSync(path).size < DETACHED_LOG_MAX_BYTES) {
			return;
		}
		rmSync(`${path}.1`, { force: true });
		renameSync(path, `${path}.1`);
	} catch {
		// No log yet, or it cannot be rotated: appending is still fine.
	}
}

function tryOpenDetachedLogFd(path: string | undefined): number | undefined {
	if (!path?.trim()) {
		return undefined;
	}
	try {
		ensureParentDir(path);
		rotateOversizedLog(path);
		return openSync(path, "a");
	} catch {
		return undefined;
	}
}

export function spawnDetachedConnector(
	commandPrefixArgs: string[],
	rawArgs: string[],
	childEnvKey: string,
	options?: {
		logPath?: string;
		component?: string;
		metadata?: Record<string, unknown>;
	},
): number {
	const command = buildDetachedConnectorCommand(commandPrefixArgs, rawArgs);
	if (!command) {
		try {
			const logger = createCliLoggerAdapter({
				runtime: "cli",
				component: options?.component ?? "connectors",
			});
			logger.core.error?.("Unable to resolve detached connector command", {
				commandPrefixArgs,
				rawArgs,
				childEnvKey,
				entryArg: process.argv[1],
				cwd: process.cwd(),
				logPath: options?.logPath,
				...options?.metadata,
			});
		} catch {
			// Best-effort logging only.
		}
		return 0;
	}
	const detachedLogFd = tryOpenDetachedLogFd(options?.logPath);
	try {
		const child = spawn(command.launcher, command.childArgs, {
			cwd: process.cwd(),
			detached: true,
			stdio:
				detachedLogFd === undefined
					? "ignore"
					: ["ignore", detachedLogFd, detachedLogFd],
			env: buildDetachedConnectorEnv(childEnvKey),
			// Prevent a console window from appearing on Windows; detached
			// processes otherwise allocate a new visible console.
			windowsHide: true,
		});
		logSpawnedProcess({
			component: options?.component ?? "connectors",
			command: [command.launcher, ...command.childArgs],
			childPid: child.pid ?? undefined,
			cwd: process.cwd(),
			detached: true,
			metadata: {
				childEnvKey,
				purpose: "connector.detached",
				logPath: options?.logPath,
				...options?.metadata,
			},
		});
		child.unref();
		return child.pid ?? 0;
	} catch (error) {
		try {
			const logger = createCliLoggerAdapter({
				runtime: "cli",
				component: options?.component ?? "connectors",
			});
			logger.core.error?.("Failed to spawn detached connector", {
				error,
				command: [command.launcher, ...command.childArgs].join(" "),
				commandArgs: command.childArgs,
				childEnvKey,
				logPath: options?.logPath,
				...options?.metadata,
			});
		} catch {
			// Best-effort logging only.
		}
		return 0;
	} finally {
		if (detachedLogFd !== undefined) {
			try {
				closeSync(detachedLogFd);
			} catch {
				// Best-effort cleanup only.
			}
		}
	}
}

export const __test__ = {
	buildDetachedConnectorArgs,
	buildDetachedConnectorCommand,
	buildDetachedConnectorEnv,
	tryReplaceStaleConnectorStateFile,
	rotateOversizedLog,
	DETACHED_LOG_MAX_BYTES,
};

export function readJsonFile<T>(path: string, fallback: T): T {
	if (!existsSync(path)) {
		return fallback;
	}
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as T;
		return parsed ?? fallback;
	} catch {
		return fallback;
	}
}

export function writeJsonFile(path: string, value: unknown): void {
	ensureParentDir(path);
	writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

/**
 * Atomically claim a connector state path for this process.
 *
 * Uses O_EXCL so two concurrent `cline connect` launches cannot both observe
 * "no running instance" and both proceed. Returns undefined when another live
 * connector already owns the path (or a concurrent claim won the race).
 */
export function tryClaimConnectorStateFile(
	statePath: string,
	createState: (
		claimId: string,
	) => { claimId: string; pid: number } & Record<string, unknown>,
	processProbe: ProcessProbe = defaultProcessProbe,
): { claimId: string } | undefined {
	ensureParentDir(statePath);
	const claimId = randomUUID();
	const state = createState(claimId);
	const payload = `${JSON.stringify(state, null, 2)}
`;

	if (tryCreateConnectorStateFile(statePath, payload)) {
		return { claimId };
	}

	let observedPayload: string;
	try {
		observedPayload = readFileSync(statePath, "utf8");
	} catch {
		return undefined;
	}
	try {
		const existing = JSON.parse(observedPayload) as { pid?: unknown };
		const existingPid =
			typeof existing.pid === "number" ? existing.pid : undefined;
		if (existingPid !== undefined && processProbe.isRunning(existingPid)) {
			return undefined;
		}
	} catch (error) {
		if (!(error instanceof SyntaxError)) {
			return undefined;
		}
	}

	return tryReplaceStaleConnectorStateFile(
		statePath,
		observedPayload,
		payload,
		processProbe,
	)
		? { claimId }
		: undefined;
}

function tryCreateConnectorStateFile(
	statePath: string,
	payload: string,
): boolean {
	let fd: number;
	try {
		fd = openSync(statePath, "wx");
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error
				? String((error as NodeJS.ErrnoException).code)
				: undefined;
		if (code === "EEXIST") {
			return false;
		}
		throw error;
	}
	try {
		writeFileSync(fd, payload, "utf8");
	} finally {
		closeSync(fd);
	}
	return true;
}

/**
 * Replaces exactly the stale generation that the caller observed.
 *
 * Each contender atomically links its ownership record into a guard keyed by
 * the observed generation. A live guard owner blocks replacement. If an owner
 * dies in the critical section, contenders append a successor guard rather
 * than deleting the existing one, so stale recovery remains crash-safe.
 */
function tryReplaceStaleConnectorStateFile(
	statePath: string,
	observedPayload: string,
	replacementPayload: string,
	processProbe: ProcessProbe = defaultProcessProbe,
): boolean {
	let replacement: { claimId?: unknown; pid?: unknown };
	try {
		replacement = JSON.parse(replacementPayload) as {
			claimId?: unknown;
			pid?: unknown;
		};
	} catch {
		return false;
	}
	if (
		typeof replacement.claimId !== "string" ||
		typeof replacement.pid !== "number"
	) {
		return false;
	}

	const generation = createHash("sha256").update(observedPayload).digest("hex");
	const ownerPayload = `${JSON.stringify(
		{
			claimId: replacement.claimId,
			pid: replacement.pid,
			processStartToken: processProbe.getStartToken(replacement.pid),
		},
		null,
		2,
	)}
`;
	const candidatePath = `${statePath}.${replacement.claimId}.candidate`;
	if (!tryCreateConnectorStateFile(candidatePath, ownerPayload)) {
		return false;
	}

	const guardPaths: string[] = [];
	let acquiredGuard = false;
	try {
		let guardPath = `${statePath}.${generation}.claim`;
		while (true) {
			guardPaths.push(guardPath);
			try {
				linkSync(candidatePath, guardPath);
				acquiredGuard = true;
				break;
			} catch (error) {
				const code =
					error && typeof error === "object" && "code" in error
						? String((error as NodeJS.ErrnoException).code)
						: undefined;
				if (code !== "EEXIST") {
					throw error;
				}
			}

			let guardPayload: string;
			try {
				guardPayload = readFileSync(guardPath, "utf8");
			} catch {
				return false;
			}
			try {
				const guardOwner = JSON.parse(guardPayload) as {
					pid?: unknown;
					processStartToken?: unknown;
				};
				if (
					typeof guardOwner.pid === "number" &&
					processProbe.isRunning(guardOwner.pid)
				) {
					const runningStartToken = processProbe.getStartToken(guardOwner.pid);
					if (
						typeof guardOwner.processStartToken !== "string" ||
						runningStartToken === undefined ||
						runningStartToken === guardOwner.processStartToken
					) {
						return false;
					}
				}
			} catch {
				// Invalid ownership metadata cannot identify a live owner.
			}

			const successor = createHash("sha256")
				.update(guardPath)
				.update("\0")
				.update(guardPayload)
				.digest("hex");
			guardPath = `${statePath}.${generation}.${successor}.claim`;
		}

		if (readFileSync(statePath, "utf8") !== observedPayload) {
			return false;
		}
		rmSync(statePath);
		return tryCreateConnectorStateFile(statePath, replacementPayload);
	} catch {
		return false;
	} finally {
		rmSync(candidatePath, { force: true });
		if (acquiredGuard) {
			for (const guardPath of guardPaths) {
				rmSync(guardPath, { force: true });
			}
		}
	}
}

export function removeFile(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {}
}

export function parseRowMetadata(
	row:
		| HubSessionRow
		| {
				metadata?: Record<string, unknown>;
				parentSessionId?: string | null;
				sessionId: string;
		  },
): { metadata?: Record<string, unknown>; parentSessionId?: string } {
	const metadata =
		row.metadata && typeof row.metadata === "object" ? row.metadata : undefined;
	return {
		metadata,
		parentSessionId: row.parentSessionId?.trim() || undefined,
	};
}

export function parseLocalRowMetadata(row: {
	metadata?: Record<string, unknown> | null;
}): Record<string, unknown> | undefined {
	return row.metadata && typeof row.metadata === "object"
		? row.metadata
		: undefined;
}

function extractMessageReplyText(message: unknown): string | undefined {
	if (!message || typeof message !== "object") {
		return undefined;
	}
	const record = message as { role?: unknown; content?: unknown };
	if (record.role !== "assistant") {
		return undefined;
	}
	const content = record.content;
	if (typeof content === "string" && content.trim()) {
		return content.trim();
	}
	if (!Array.isArray(content)) {
		return undefined;
	}
	const joined = content
		.map((part) => {
			if (typeof part === "string") {
				return part;
			}
			if (!part || typeof part !== "object") {
				return "";
			}
			const record = part as { text?: unknown };
			return typeof record.text === "string" ? record.text : "";
		})
		.join("")
		.trim();
	return joined || undefined;
}

export async function readSessionReplyText(
	client: HubSessionClient,
	sessionId: string,
	options: { minMessageIndex?: number } = {},
): Promise<string | undefined> {
	try {
		const messages = await client.readMessages(sessionId);
		const minMessageIndex = Math.max(0, options.minMessageIndex ?? 0);
		for (
			let index = messages.length - 1;
			index >= minMessageIndex;
			index -= 1
		) {
			const text = extractMessageReplyText(messages[index]);
			if (text) {
				return text;
			}
		}
	} catch {}
	return undefined;
}

export async function readSessionMessageCount(
	client: HubSessionClient,
	sessionId: string,
): Promise<number | undefined> {
	try {
		return (await client.readMessages(sessionId)).length;
	} catch {}
	return undefined;
}
