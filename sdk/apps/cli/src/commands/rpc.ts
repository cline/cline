import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { resolveClineDataDir } from "@clinebot/core";
import {
	createSqliteRpcSessionBackend,
	tryAcquireRpcSpawnLease,
} from "@clinebot/core/node";
import {
	getRpcServerHealth,
	RPC_PROTOCOL_VERSION,
	RpcSessionClient,
	registerRpcClient,
	requestRpcServerShutdown,
	startRpcServer,
	stopRpcServer,
} from "@clinebot/rpc";
import { CLINE_DEFAULT_RPC_ADDRESS } from "@clinebot/shared";
import { Command } from "commander";
import { createCliLoggerAdapter } from "../logging/adapter";
import { logSpawnedProcess } from "../logging/process";
import { createRpcRuntimeHandlers } from "./rpc-runtime";

const c = {
	dim: "\x1b[2m",
	reset: "\x1b[0m",
};

const RPC_STARTUP_LOCK_MAX_AGE_MS = 30_000;
const RPC_STARTUP_LOCK_WAIT_MS = 15_000;
const RPC_STARTUP_LOCK_POLL_MS = 100;
const RPC_STARTUP_LOCK_BYPASS_ENV = "CLINE_RPC_STARTUP_LOCK_HELD";
const RPC_OWNER_ID_ENV = "CLINE_RPC_OWNER_ID";
const RPC_BUILD_ID_ENV = "CLINE_RPC_BUILD_ID";
const RPC_DISCOVERY_PATH_ENV = "CLINE_RPC_DISCOVERY_PATH";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type RpcStartupLockRecord = {
	pid: number;
	address: string;
	acquiredAt: string;
};

type RpcDiscoveryRecord = {
	ownerId: string;
	buildId: string;
	entryPath?: string;
	address: string;
	pid?: number;
	serverId?: string;
	startedAt?: string;
	protocolVersion: string;
	updatedAt: string;
};

type RpcOwnerContext = {
	ownerId: string;
	buildId: string;
	entryPath?: string;
	discoveryPath: string;
};

type EnsureResult = {
	address: string;
	action: "reuse" | "new-port" | "started";
};

interface RpcCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function sanitizeKey(value: string): string {
	return value.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function hashValue(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function errorCode(error: unknown): string {
	return error && typeof error === "object" && "code" in error
		? String((error as { code?: unknown }).code)
		: "";
}

function collectMeta(value: string, previous: string[]): string[] {
	return previous.concat(value);
}

function parseMetaEntries(entries: string[]): Record<string, string> {
	const metadata: Record<string, string> = {};
	for (const raw of entries) {
		const sep = raw.indexOf("=");
		if (sep <= 0 || sep >= raw.length - 1) continue;
		const key = raw.slice(0, sep).trim();
		const value = raw.slice(sep + 1).trim();
		if (key && value) metadata[key] = value;
	}
	return metadata;
}

function parseRpcAddress(address: string): { host: string; port: number } {
	const trimmed = address.trim();
	const idx = trimmed.lastIndexOf(":");
	if (idx <= 0 || idx >= trimmed.length - 1) {
		throw new Error(`invalid rpc address: ${address}`);
	}
	const host = trimmed.slice(0, idx);
	const port = Number.parseInt(trimmed.slice(idx + 1), 10);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`invalid rpc port in address: ${address}`);
	}
	return { host, port };
}

// ---------------------------------------------------------------------------
// Owner context & discovery
// ---------------------------------------------------------------------------

function resolveRpcEntrypoint(): string | undefined {
	const entryArg = process.argv[1]?.trim();
	if (!entryArg) return undefined;
	return isAbsolute(entryArg) ? entryArg : resolvePath(process.cwd(), entryArg);
}

function getEntrypointMtimeMs(path: string | undefined): number {
	if (!path) return 0;
	try {
		return statSync(path).mtimeMs || 0;
	} catch {
		return 0;
	}
}

function resolveCurrentRpcOwnerContext(): RpcOwnerContext {
	const entryPath = resolveRpcEntrypoint();
	const defaultOwnerBasis = entryPath
		? `${entryPath}`
		: `pid:${process.pid}:cwd:${process.cwd()}`;
	const ownerId =
		process.env[RPC_OWNER_ID_ENV]?.trim() ||
		`cli-${hashValue(defaultOwnerBasis)}`;
	const defaultBuildBasis = `${defaultOwnerBasis}:${getEntrypointMtimeMs(entryPath)}`;
	const buildId =
		process.env[RPC_BUILD_ID_ENV]?.trim() ||
		`build-${hashValue(defaultBuildBasis)}`;
	const discoveryPath =
		process.env[RPC_DISCOVERY_PATH_ENV]?.trim() ||
		join(
			resolveClineDataDir(),
			"rpc",
			"owners",
			`${sanitizeKey(ownerId)}.json`,
		);
	return { ownerId, buildId, entryPath, discoveryPath };
}

async function readRpcDiscovery(
	owner: RpcOwnerContext,
): Promise<RpcDiscoveryRecord | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(owner.discoveryPath, "utf8"),
		) as Partial<RpcDiscoveryRecord>;
		if (
			typeof parsed.ownerId !== "string" ||
			typeof parsed.buildId !== "string" ||
			typeof parsed.address !== "string" ||
			typeof parsed.protocolVersion !== "string"
		) {
			return undefined;
		}
		return {
			ownerId: parsed.ownerId,
			buildId: parsed.buildId,
			address: parsed.address,
			protocolVersion: parsed.protocolVersion,
			updatedAt:
				typeof parsed.updatedAt === "string"
					? parsed.updatedAt
					: new Date().toISOString(),
			entryPath:
				typeof parsed.entryPath === "string" ? parsed.entryPath : undefined,
			pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
			serverId:
				typeof parsed.serverId === "string" ? parsed.serverId : undefined,
			startedAt:
				typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
		};
	} catch {
		return undefined;
	}
}

async function writeRpcDiscovery(
	owner: RpcOwnerContext,
	record: Omit<RpcDiscoveryRecord, "ownerId" | "buildId" | "updatedAt">,
): Promise<void> {
	await mkdir(dirname(owner.discoveryPath), { recursive: true });
	await writeFile(
		owner.discoveryPath,
		JSON.stringify(
			{
				ownerId: owner.ownerId,
				buildId: owner.buildId,
				updatedAt: new Date().toISOString(),
				...record,
			} satisfies RpcDiscoveryRecord,
			null,
			2,
		),
		"utf8",
	);
}

async function clearRpcDiscovery(owner: RpcOwnerContext): Promise<void> {
	await rm(owner.discoveryPath, { force: true }).catch(() => undefined);
}

async function clearRpcDiscoveryIfAddressMatches(
	owner: RpcOwnerContext,
	address: string,
): Promise<void> {
	const current = await readRpcDiscovery(owner);
	if (current?.address === address) await clearRpcDiscovery(owner);
}

// ---------------------------------------------------------------------------
// Health / compatibility probes
// ---------------------------------------------------------------------------

function isHealthCompatible(
	health: Awaited<ReturnType<typeof getRpcServerHealth>> | undefined,
): boolean {
	const serverVersion = health?.rpcVersion?.trim() || "";
	return !!serverVersion && serverVersion === RPC_PROTOCOL_VERSION;
}

function isUnimplementedError(error: unknown): boolean {
	if (Number(errorCode(error)) === 12) return true;
	const message = error instanceof Error ? error.message : String(error);
	return message.toUpperCase().includes("UNIMPLEMENTED");
}

function isAuthenticationError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /missing authentication header|401\b|unauthenticated|unauthorized/i.test(
		message,
	);
}

function isProbeBlocked(error: unknown): boolean {
	return isUnimplementedError(error) || isAuthenticationError(error);
}

async function hasRuntimeMethods(address: string): Promise<boolean> {
	const client = new RpcSessionClient({ address });
	try {
		try {
			await client.stopRuntimeSession("__rpc_probe__");
		} catch (error) {
			if (isProbeBlocked(error)) return false;
		}
		return true;
	} catch (error) {
		return !isProbeBlocked(error);
	} finally {
		client.close();
	}
}

async function isCompatibleRuntime(address: string): Promise<boolean> {
	const health = await getRpcServerHealth(address);
	return (
		!!health?.running &&
		isHealthCompatible(health) &&
		(await hasRuntimeMethods(address))
	);
}

// ---------------------------------------------------------------------------
// Port scanning
// ---------------------------------------------------------------------------

async function isPortFree(host: string, port: number): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.once("listening", () => server.close(() => resolve(true)));
		server.listen({ host, port });
	});
}

async function findAvailableAddress(baseAddress: string): Promise<string> {
	const { host, port } = parseRpcAddress(baseAddress);
	for (let offset = 1; offset <= 40; offset += 1) {
		const candidate = port + offset;
		if (candidate > 65535) break;
		if (await isPortFree(host, candidate)) return `${host}:${candidate}`;
	}
	throw new Error(`no available rpc port near ${baseAddress}`);
}

// ---------------------------------------------------------------------------
// Startup lock
// ---------------------------------------------------------------------------

function getRpcStartupLockDir(address: string): string {
	const normalized = address.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_");
	return join(resolveClineDataDir(), "locks", `rpc-start-${normalized}.lock`);
}

function isPidAlive(pid: number | undefined): boolean {
	if (!Number.isInteger(pid) || !pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return errorCode(error) === "EPERM";
	}
}

async function writeRpcStartupLockRecord(
	lockDir: string,
	address: string,
): Promise<void> {
	const record: RpcStartupLockRecord = {
		pid: process.pid,
		address,
		acquiredAt: new Date().toISOString(),
	};
	await writeFile(
		join(lockDir, "owner.json"),
		JSON.stringify(record, null, 2),
		"utf8",
	);
}

async function readRpcStartupLockRecord(
	lockDir: string,
): Promise<RpcStartupLockRecord | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(join(lockDir, "owner.json"), "utf8"),
		) as Partial<RpcStartupLockRecord>;
		if (
			typeof parsed.pid !== "number" ||
			typeof parsed.address !== "string" ||
			typeof parsed.acquiredAt !== "string"
		) {
			return undefined;
		}
		return {
			pid: parsed.pid,
			address: parsed.address,
			acquiredAt: parsed.acquiredAt,
		};
	} catch {
		return undefined;
	}
}

async function removeRpcStartupLockDir(lockDir: string): Promise<void> {
	await rm(lockDir, { recursive: true, force: true }).catch(() => {});
}

async function withRpcStartupLock<T>(
	address: string,
	action: () => Promise<T>,
): Promise<T> {
	if (process.env[RPC_STARTUP_LOCK_BYPASS_ENV] === "1") {
		return await action();
	}

	const lockDir = getRpcStartupLockDir(address);
	const startedAt = Date.now();
	await mkdir(dirname(lockDir), { recursive: true });

	while (true) {
		try {
			await mkdir(lockDir, { recursive: false });
			await writeRpcStartupLockRecord(lockDir, address);
			try {
				return await action();
			} finally {
				await removeRpcStartupLockDir(lockDir);
			}
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;

			const existing = await readRpcStartupLockRecord(lockDir);
			const acquiredAtMs = existing
				? new Date(existing.acquiredAt).getTime()
				: Number.NaN;
			const isStale =
				!existing ||
				!Number.isFinite(acquiredAtMs) ||
				Date.now() - acquiredAtMs > RPC_STARTUP_LOCK_MAX_AGE_MS ||
				!isPidAlive(existing.pid);
			if (isStale) {
				await removeRpcStartupLockDir(lockDir);
				continue;
			}

			if (Date.now() - startedAt >= RPC_STARTUP_LOCK_WAIT_MS) {
				throw new Error(
					`timed out waiting for rpc startup lock at ${address} (owner pid=${existing.pid})`,
				);
			}
			await sleep(RPC_STARTUP_LOCK_POLL_MS);
		}
	}
}

// ---------------------------------------------------------------------------
// Detached spawn & readiness
// ---------------------------------------------------------------------------

function spawnRpcStartDetached(address: string, owner: RpcOwnerContext): void {
	const lease = tryAcquireRpcSpawnLease(address);
	if (!lease) return;

	const entry = owner.entryPath ?? resolveRpcEntrypoint();
	if (!entry) {
		lease.release();
		throw new Error("unable to resolve CLI entrypoint for detached rpc start");
	}
	const conditionsArg = process.execArgv.find((arg) =>
		arg.startsWith("--conditions="),
	);
	const childArgs = [
		...(conditionsArg ? [conditionsArg] : []),
		entry,
		"rpc",
		"start",
		"--address",
		address,
	];
	const child = spawn(process.execPath, childArgs, {
		detached: true,
		stdio: "ignore",
		env: {
			...process.env,
			[RPC_STARTUP_LOCK_BYPASS_ENV]: "1",
			[RPC_OWNER_ID_ENV]: owner.ownerId,
			[RPC_BUILD_ID_ENV]: owner.buildId,
			[RPC_DISCOVERY_PATH_ENV]: owner.discoveryPath,
		},
		cwd: process.cwd(),
	});
	logSpawnedProcess({
		component: "rpc",
		command: [process.execPath, ...childArgs],
		childPid: child.pid ?? undefined,
		detached: true,
		cwd: process.cwd(),
		metadata: { rpcAddress: address, purpose: "rpc.start.background" },
	});
	child.unref();
	setTimeout(() => lease.release(), 10_000).unref();
}

async function waitForRuntimeReady(address: string): Promise<boolean> {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (await isCompatibleRuntime(address)) return true;
		await sleep(100);
	}
	return false;
}

// ---------------------------------------------------------------------------
// Shutdown helper
// ---------------------------------------------------------------------------

async function tryShutdownOwnedServer(
	owner: RpcOwnerContext,
	discovery: RpcDiscoveryRecord | undefined,
): Promise<void> {
	const address = discovery?.address?.trim();
	if (!address) {
		await clearRpcDiscovery(owner);
		return;
	}
	const shutdown = await requestRpcServerShutdown(address).catch(
		() => undefined,
	);
	if (shutdown?.accepted) {
		for (let i = 0; i < 20; i++) {
			if (!(await getRpcServerHealth(address))?.running) {
				await clearRpcDiscovery(owner);
				return;
			}
			await sleep(100);
		}
	}
	if (!(await getRpcServerHealth(address))?.running) {
		await clearRpcDiscovery(owner);
	}
}

// ---------------------------------------------------------------------------
// Address resolution
// ---------------------------------------------------------------------------

async function ensureCompatibleRpcAddress(
	requestedAddress: string,
	options?: { lockHeld?: boolean; owner: RpcOwnerContext },
): Promise<EnsureResult> {
	const owner = options?.owner ?? resolveCurrentRpcOwnerContext();
	if (!options?.lockHeld) {
		return withRpcStartupLock(requestedAddress, () =>
			ensureCompatibleRpcAddress(requestedAddress, {
				lockHeld: true,
				owner,
			}),
		);
	}

	// Check existing discovery record first.
	const discovery = await readRpcDiscovery(owner);
	if (discovery?.address) {
		const discoveredHealth = await getRpcServerHealth(discovery.address);
		if (
			discoveredHealth?.running &&
			discovery.buildId === owner.buildId &&
			discovery.protocolVersion === RPC_PROTOCOL_VERSION &&
			isHealthCompatible(discoveredHealth) &&
			(await hasRuntimeMethods(discovery.address))
		) {
			return { address: discovery.address, action: "reuse" };
		}
		await tryShutdownOwnedServer(owner, discovery);
	}

	// Check the requested address.
	const requestedHealth = await getRpcServerHealth(requestedAddress);
	const { host, port } = parseRpcAddress(requestedAddress);

	if (!requestedHealth?.running) {
		if (await isPortFree(host, port)) {
			return { address: requestedAddress, action: "started" };
		}
		return {
			address: await findAvailableAddress(requestedAddress),
			action: "new-port",
		};
	}

	// Requested address has a running server — check compatibility.
	if (
		isHealthCompatible(requestedHealth) &&
		(await hasRuntimeMethods(requestedAddress))
	) {
		// Adopt a compatible server only if we have no prior discovery.
		if (!discovery) {
			return { address: requestedAddress, action: "reuse" };
		}
	}

	return {
		address: await findAvailableAddress(requestedAddress),
		action: "new-port",
	};
}

export async function ensureRpcRuntimeAddress(
	requestedAddress: string,
): Promise<string> {
	const owner = resolveCurrentRpcOwnerContext();
	return withRpcStartupLock(requestedAddress, async () => {
		const ensured = await ensureCompatibleRpcAddress(requestedAddress, {
			lockHeld: true,
			owner,
		});
		return ensureRpcRuntimeAddressFromResolved(ensured, owner);
	});
}

async function ensureRpcRuntimeAddressFromResolved(
	ensured: EnsureResult,
	owner: RpcOwnerContext,
): Promise<string> {
	if (ensured.action !== "reuse") {
		spawnRpcStartDetached(ensured.address, owner);
	}

	if (!(await waitForRuntimeReady(ensured.address))) {
		throw new Error(`failed to ensure rpc runtime at ${ensured.address}`);
	}
	const health = await getRpcServerHealth(ensured.address);
	await writeRpcDiscovery(owner, {
		address: ensured.address,
		pid: undefined,
		serverId: health?.serverId,
		startedAt: health?.startedAt,
		protocolVersion: RPC_PROTOCOL_VERSION,
		entryPath: owner.entryPath,
	});

	return ensured.address;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatUptime(startedAt: string): string {
	const startMs = new Date(startedAt).getTime();
	if (!Number.isFinite(startMs)) return "unknown";
	let seconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
	const days = Math.floor(seconds / 86400);
	seconds %= 86400;
	const hours = Math.floor(seconds / 3600);
	seconds %= 3600;
	const minutes = Math.floor(seconds / 60);
	seconds %= 60;
	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	parts.push(`${seconds}s`);
	return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

export async function runRpcEnsureCommand(
	options: { address: string; json?: boolean },
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const { address: requestedAddress, json: jsonOutput } = options;
	const owner = resolveCurrentRpcOwnerContext();
	let ensured: EnsureResult | undefined;
	try {
		await withRpcStartupLock(requestedAddress, async () => {
			ensured = await ensureCompatibleRpcAddress(requestedAddress, {
				lockHeld: true,
				owner,
			});
			await ensureRpcRuntimeAddressFromResolved(ensured, owner);
		});
	} catch (error) {
		writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
	if (!ensured) {
		writeErr(`failed to ensure rpc runtime at ${requestedAddress}`);
		return 1;
	}

	if (jsonOutput) {
		writeln(
			JSON.stringify({
				running: true,
				requestedAddress,
				address: ensured.address,
				action: ensured.action,
			}),
		);
	} else {
		writeln(
			`${c.dim}[rpc] ensured address=${ensured.address} (requested=${requestedAddress}, action=${ensured.action})${c.reset}`,
		);
	}
	return 0;
}

async function runRpcStartCommand(
	options: { address: string },
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const startupLogger = createCliLoggerAdapter({
		runtime: "cli",
		component: "rpc-start",
	}).core;
	const normalizedAddress = options.address;
	if (!normalizedAddress) {
		writeErr("rpc start requires a non-empty address");
		startupLogger.error?.("RPC start rejected: empty address");
		return 1;
	}

	let startAddress = normalizedAddress;
	let handle: Awaited<ReturnType<typeof startRpcServer>> | undefined;
	let reusedExisting = false;
	let existingServerId: string | undefined;
	const owner = resolveCurrentRpcOwnerContext();
	let startedAction: "new-port" | "started" = "started";

	await withRpcStartupLock(normalizedAddress, async () => {
		const ensured = await ensureCompatibleRpcAddress(normalizedAddress, {
			lockHeld: true,
			owner,
		});
		startAddress = ensured.address;
		if (ensured.action === "reuse") {
			reusedExisting = true;
			existingServerId = (await getRpcServerHealth(startAddress))?.serverId;
			return;
		}

		startedAction = ensured.action;
		process.env.CLINE_RPC_ADDRESS = startAddress;
		handle = await startRpcServer({
			address: startAddress,
			sessionBackend: createSqliteRpcSessionBackend(),
			runtimeHandlers: createRpcRuntimeHandlers(),
		});
		await writeRpcDiscovery(owner, {
			address: startAddress,
			pid: process.pid,
			serverId: handle.serverId,
			startedAt: handle.startedAt,
			protocolVersion: RPC_PROTOCOL_VERSION,
			entryPath: owner.entryPath,
		});
	});

	if (reusedExisting) {
		const health = await getRpcServerHealth(startAddress);
		await writeRpcDiscovery(owner, {
			address: startAddress,
			pid: undefined,
			serverId: health?.serverId,
			startedAt: health?.startedAt,
			protocolVersion: RPC_PROTOCOL_VERSION,
			entryPath: owner.entryPath,
		});
		startupLogger.info?.("RPC server activation reused existing instance", {
			address: startAddress,
			serverId: existingServerId,
			action: "reuse",
		});
		writeln(
			`${c.dim}[rpc] already running server_id=${existingServerId ?? "unknown"} address=${startAddress}${c.reset}`,
		);
		return 0;
	}

	if (!handle) {
		writeErr(`failed to start rpc server at ${startAddress}`);
		return 1;
	}
	startupLogger.info?.("RPC server activation started", {
		address: handle.address,
		serverId: handle.serverId,
		requestedAddress: normalizedAddress,
		action: startedAction,
	});
	writeln(
		`${c.dim}[rpc] started server_id=${handle.serverId} address=${handle.address}${c.reset}`,
	);
	writeln(`${c.dim}[rpc] press Ctrl+C to stop${c.reset}`);

	await new Promise<void>((resolve) => {
		const shutdown = () => {
			process.off("SIGINT", shutdown);
			process.off("SIGTERM", shutdown);
			resolve();
		};
		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	});

	await stopRpcServer();
	await clearRpcDiscoveryIfAddressMatches(owner, handle.address);
	startupLogger.info?.("RPC server stopped", {
		address: handle.address,
		serverId: handle.serverId,
	});
	writeln(`${c.dim}[rpc] stopped${c.reset}`);
	return 0;
}

async function runRpcStatusCommand(
	options: { address: string; json?: boolean },
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const normalizedAddress = options.address;
	if (!normalizedAddress) {
		writeErr("rpc status requires a non-empty address");
		return 1;
	}

	const health = await getRpcServerHealth(normalizedAddress);
	if (!health?.running) {
		if (options.json) {
			writeln(JSON.stringify({ running: false, address: normalizedAddress }));
		} else {
			writeln(
				`${c.dim}[rpc] not running address=${normalizedAddress}${c.reset}`,
			);
		}
		return 1;
	}

	const uptime = health.startedAt ? formatUptime(health.startedAt) : "unknown";
	if (options.json) {
		writeln(
			JSON.stringify({
				running: true,
				serverId: health.serverId,
				address: health.address,
				startedAt: health.startedAt || null,
				uptime,
				rpcVersion: health.rpcVersion || null,
			}),
		);
	} else {
		const version = health.rpcVersion ? ` version=${health.rpcVersion}` : "";
		writeln(
			`${c.dim}[rpc] running server_id=${health.serverId} address=${health.address}${version} uptime=${uptime}${c.reset}`,
		);
	}
	return 0;
}

async function runRpcStopCommand(
	options: { address: string },
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const normalizedAddress = options.address;
	const owner = resolveCurrentRpcOwnerContext();
	if (!normalizedAddress) {
		writeErr("rpc stop requires a non-empty address");
		return 1;
	}

	const health = await getRpcServerHealth(normalizedAddress);
	if (!health?.running) {
		writeln(`${c.dim}[rpc] not running address=${normalizedAddress}${c.reset}`);
		return 0;
	}

	const shutdown = await requestRpcServerShutdown(normalizedAddress);
	if (!shutdown?.accepted) {
		writeErr(
			`failed to request rpc shutdown at ${normalizedAddress} (server may have exited)`,
		);
		return 1;
	}

	for (let i = 0; i < 10; i++) {
		if (!(await getRpcServerHealth(normalizedAddress))?.running) {
			await clearRpcDiscoveryIfAddressMatches(owner, normalizedAddress);
			writeln(
				`${c.dim}[rpc] stopped server_id=${health.serverId} address=${health.address}${c.reset}`,
			);
			return 0;
		}
		await sleep(100);
	}

	writeErr(
		`rpc shutdown requested but server still reports healthy at ${health.address}`,
	);
	return 1;
}

async function runRpcRegisterCommand(
	options: {
		address: string;
		clientType: string;
		clientId?: string;
		meta: string[];
	},
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const registerLogger = createCliLoggerAdapter({
		runtime: "cli",
		component: "rpc-register",
	}).core;
	const normalizedAddress = options.address;
	if (!normalizedAddress) {
		writeErr("rpc register requires a non-empty address");
		registerLogger.error?.("RPC client registration rejected: empty address");
		return 1;
	}

	const metadata = parseMetaEntries(options.meta);
	const registration = await registerRpcClient(normalizedAddress, {
		clientId: options.clientId,
		clientType: options.clientType,
		metadata,
	});
	if (!registration?.registered) {
		registerLogger.error?.("RPC client registration failed", {
			address: normalizedAddress,
			clientType: options.clientType,
			requestedClientId: options.clientId ?? "",
			metadata,
		});
		writeErr(
			`failed to register client with rpc server at ${normalizedAddress}`,
		);
		return 1;
	}
	registerLogger.info?.("RPC client registered", {
		address: normalizedAddress,
		clientType: options.clientType,
		clientId: registration.clientId,
		requestedClientId: options.clientId ?? "",
		metadata,
	});

	writeln(
		`${c.dim}[rpc] registered client_id=${registration.clientId} address=${normalizedAddress}${c.reset}`,
	);
	return 0;
}

// ---------------------------------------------------------------------------
// Commander command tree
// ---------------------------------------------------------------------------

const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS || CLINE_DEFAULT_RPC_ADDRESS;

export function createRpcCommand(
	io: RpcCommandIo,
	setExitCode: (code: number) => void,
): Command {
	const rpc = new Command("rpc")
		.description("Manage the local RPC runtime server")
		.exitOverride()
		.allowExcessArguments()
		.argument("[subcommand]");

	const addressOption = (description?: string) =>
		`--address <host:port>${description ? ` ${description}` : ""}`;

	rpc
		.command("ensure")
		.description("Ensure the RPC runtime is running")
		.option(addressOption(), "RPC server address", DEFAULT_RPC_ADDRESS)
		.option("--json", "Output as JSON")
		.action(async function (this: Command) {
			const opts = this.opts<{ address: string; json?: boolean }>();
			setExitCode(
				await runRpcEnsureCommand(
					{ address: opts.address, json: opts.json },
					io.writeln,
					io.writeErr,
				),
			);
		});

	rpc
		.command("register")
		.description("Register an RPC client")
		.option(addressOption(), "RPC server address", DEFAULT_RPC_ADDRESS)
		.option("--client-id <id>", "Client ID")
		.option("--client-type <type>", "Client type", "desktop")
		.option(
			"--meta <key=value>",
			"Metadata entry (repeatable)",
			collectMeta,
			[],
		)
		.action(async function (this: Command) {
			const opts = this.opts<{
				address: string;
				clientId?: string;
				clientType: string;
				meta: string[];
			}>();
			setExitCode(
				await runRpcRegisterCommand(
					{
						address: opts.address,
						clientType: opts.clientType,
						clientId: opts.clientId,
						meta: opts.meta,
					},
					io.writeln,
					io.writeErr,
				),
			);
		});

	rpc
		.command("start")
		.description("Start the RPC server")
		.option(addressOption(), "RPC server address", DEFAULT_RPC_ADDRESS)
		.action(async function (this: Command) {
			const opts = this.opts<{ address: string }>();
			setExitCode(
				await runRpcStartCommand(
					{ address: opts.address },
					io.writeln,
					io.writeErr,
				),
			);
		});

	rpc
		.command("status")
		.description("Show RPC server status")
		.option(addressOption(), "RPC server address", DEFAULT_RPC_ADDRESS)
		.option("--json", "Output as JSON")
		.action(async function (this: Command) {
			const opts = this.opts<{ address: string; json?: boolean }>();
			setExitCode(
				await runRpcStatusCommand(
					{ address: opts.address, json: opts.json },
					io.writeln,
					io.writeErr,
				),
			);
		});

	rpc
		.command("stop")
		.description("Stop the RPC server")
		.option(addressOption(), "RPC server address", DEFAULT_RPC_ADDRESS)
		.action(async function (this: Command) {
			const opts = this.opts<{ address: string }>();
			setExitCode(
				await runRpcStopCommand(
					{ address: opts.address },
					io.writeln,
					io.writeErr,
				),
			);
		});

	rpc.action((subcommand?: string) => {
		if (subcommand) {
			io.writeErr(`unknown rpc subcommand "${subcommand}"`);
			setExitCode(1);
		}
	});

	return rpc;
}
