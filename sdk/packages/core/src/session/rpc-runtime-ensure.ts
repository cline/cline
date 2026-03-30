import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import {
	getRpcServerHealth,
	RPC_BUILD_VERSION,
	RPC_PROTOCOL_VERSION,
	RpcSessionClient,
	requestRpcServerShutdown,
} from "@clinebot/rpc";
import { resolveClineDataDir } from "@clinebot/shared/storage";
import { CORE_BUILD_VERSION } from "../version";

const RPC_STARTUP_LOCK_MAX_AGE_MS = 30_000;
const RPC_STARTUP_LOCK_WAIT_MS = 15_000;
const RPC_STARTUP_LOCK_POLL_MS = 100;
export const RPC_STARTUP_LOCK_BYPASS_ENV = "CLINE_RPC_STARTUP_LOCK_HELD";
export const RPC_OWNER_ID_ENV = "CLINE_RPC_OWNER_ID";
export const RPC_BUILD_ID_ENV = "CLINE_RPC_BUILD_ID";
export const RPC_DISCOVERY_PATH_ENV = "CLINE_RPC_DISCOVERY_PATH";

type RpcStartupLockRecord = {
	pid: number;
	address: string;
	acquiredAt: string;
};

export type RpcDiscoveryRecord = {
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

export type RpcOwnerContext = {
	ownerId: string;
	buildId: string;
	entryPath?: string;
	discoveryPath: string;
};

export type ResolveRpcRuntimeResult = {
	address: string;
	action: "reuse" | "new-port" | "started";
	owner: RpcOwnerContext;
};

export type EnsureRpcRuntimeOptions = {
	owner?: RpcOwnerContext;
	resolveOwner?: () => RpcOwnerContext;
	spawnIfNeeded: (
		address: string,
		owner: RpcOwnerContext,
	) => void | Promise<void>;
	readinessCheck?: (address: string) => Promise<boolean>;
};

export type ResolveRpcOwnerContextOptions = {
	discoveryPath?: string;
	hostBuildKey?: string;
	identityPath?: string;
	ownerBasis?: string;
	ownerId?: string;
	ownerPrefix?: string;
};

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

function defaultIdentityPath(): string | undefined {
	const entryArg = process.argv[1]?.trim();
	if (!entryArg) return undefined;
	return resolve(process.cwd(), entryArg);
}

export function resolveRpcRuntimeBuildKey(hostBuildKey?: string): string {
	const base = `core=${CORE_BUILD_VERSION}:rpc=${RPC_BUILD_VERSION}`;
	return hostBuildKey?.trim() ? `${base}:host=${hostBuildKey.trim()}` : base;
}

export function resolveRpcOwnerContext(
	options: ResolveRpcOwnerContextOptions = {},
): RpcOwnerContext {
	const entryPath = options.identityPath?.trim() || defaultIdentityPath();
	const defaultOwnerBasis =
		options.ownerBasis?.trim() ||
		(entryPath ? `${entryPath}` : `pid:${process.pid}:cwd:${process.cwd()}`);
	const ownerPrefix = options.ownerPrefix?.trim() || "rpc";
	const ownerId =
		options.ownerId?.trim() ||
		process.env[RPC_OWNER_ID_ENV]?.trim() ||
		`${ownerPrefix}-${hashValue(defaultOwnerBasis)}`;
	const defaultBuildBasis = `${defaultOwnerBasis}:${resolveRpcRuntimeBuildKey(options.hostBuildKey)}`;
	const buildId =
		process.env[RPC_BUILD_ID_ENV]?.trim() ||
		`build-${hashValue(defaultBuildBasis)}`;
	const discoveryPath =
		options.discoveryPath?.trim() ||
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

export async function recordRpcDiscovery(
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

export async function clearRpcDiscoveryIfAddressMatches(
	owner: RpcOwnerContext,
	address: string,
): Promise<void> {
	const current = await readRpcDiscovery(owner);
	if (current?.address === address) await clearRpcDiscovery(owner);
}

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

export async function isCompatibleRuntime(address: string): Promise<boolean> {
	const health = await getRpcServerHealth(address);
	return (
		!!health?.running &&
		isHealthCompatible(health) &&
		(await hasRuntimeMethods(address))
	);
}

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

export async function withRpcStartupLock<T>(
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
		for (let i = 0; i < 20; i += 1) {
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

export async function resolveEnsuredRpcRuntime(
	requestedAddress: string,
	options: {
		owner?: RpcOwnerContext;
		resolveOwner?: () => RpcOwnerContext;
	} = {},
): Promise<ResolveRpcRuntimeResult> {
	const owner =
		options.owner ?? options.resolveOwner?.() ?? resolveRpcOwnerContext();
	return await withRpcStartupLock(requestedAddress, async () => {
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
				return {
					address: discovery.address,
					action: "reuse",
					owner,
				} satisfies ResolveRpcRuntimeResult;
			}
			await tryShutdownOwnedServer(owner, discovery);
		}

		const requestedHealth = await getRpcServerHealth(requestedAddress);
		const { host, port } = parseRpcAddress(requestedAddress);

		if (!requestedHealth?.running) {
			if (await isPortFree(host, port)) {
				return {
					address: requestedAddress,
					action: "started",
					owner,
				} satisfies ResolveRpcRuntimeResult;
			}
			return {
				address: await findAvailableAddress(requestedAddress),
				action: "new-port",
				owner,
			} satisfies ResolveRpcRuntimeResult;
		}

		if (
			isHealthCompatible(requestedHealth) &&
			(await hasRuntimeMethods(requestedAddress))
		) {
			if (!discovery) {
				return {
					address: requestedAddress,
					action: "reuse",
					owner,
				} satisfies ResolveRpcRuntimeResult;
			}
		}

		return {
			address: await findAvailableAddress(requestedAddress),
			action: "new-port",
			owner,
		} satisfies ResolveRpcRuntimeResult;
	});
}

export async function waitForCompatibleRpcRuntime(
	address: string,
	readinessCheck: (address: string) => Promise<boolean> = isCompatibleRuntime,
): Promise<boolean> {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (await readinessCheck(address)) return true;
		await sleep(100);
	}
	return false;
}

export async function ensureRpcRuntimeAddress(
	requestedAddress: string,
	options: EnsureRpcRuntimeOptions,
): Promise<ResolveRpcRuntimeResult> {
	const resolved = await resolveEnsuredRpcRuntime(requestedAddress, {
		owner: options.owner,
		resolveOwner: options.resolveOwner,
	});
	if (resolved.action !== "reuse") {
		await options.spawnIfNeeded(resolved.address, resolved.owner);
	}
	if (
		!(await waitForCompatibleRpcRuntime(
			resolved.address,
			options.readinessCheck,
		))
	) {
		throw new Error(`failed to ensure rpc runtime at ${resolved.address}`);
	}
	const health = await getRpcServerHealth(resolved.address);
	await recordRpcDiscovery(resolved.owner, {
		address: resolved.address,
		pid: undefined,
		serverId: health?.serverId,
		startedAt: health?.startedAt,
		protocolVersion: RPC_PROTOCOL_VERSION,
		entryPath: resolved.owner.entryPath,
	});
	return resolved;
}
