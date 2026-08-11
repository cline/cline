import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type HubCompatibilityResult,
	type HubProtocolMetadata,
	isHubProtocolCompatible,
} from "@cline/shared";
import { resolveClineDataDir, resolveClineDir } from "@cline/shared/storage";
import corePackage from "../../../package.json";

declare const __CLINE_CORE_RUNTIME_BUILD_ID__: string | undefined;

const HUB_DISCOVERY_ENV = "CLINE_HUB_DISCOVERY_PATH";
const HUB_BUILD_ID_ENV = "CLINE_HUB_BUILD_ID";
const HUB_STARTUP_LOCK_MAX_AGE_MS = 30_000;
const HUB_STARTUP_LOCK_WAIT_MS = 15_000;
const HUB_STARTUP_LOCK_POLL_MS = 100;

export interface HubServerDiscoveryRecord {
	hubId: string;
	protocolVersion: string;
	minClientProtocolVersion?: string;
	maxClientProtocolVersion?: string;
	capabilities?: readonly string[];
	coreVersion?: string;
	buildId?: string;
	authToken: string;
	host: string;
	port: number;
	url: string;
	pid?: number;
	startedAt: string;
	updatedAt: string;
}

export type HubServerProbeRecord = {
	protocolVersion: string;
	minClientProtocolVersion?: string;
	maxClientProtocolVersion?: string;
	capabilities?: readonly string[];
	coreVersion?: string;
	buildId?: string;
	host: string;
	port: number;
	url: string;
	hubId?: string;
	authToken?: string;
	pid?: number;
	startedAt?: string;
	updatedAt?: string;
};

export interface HubOwnerContext {
	ownerId: string;
	discoveryPath: string;
}

function sanitizeKey(value: string): string {
	return value.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function hashValue(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function isPidAlive(pid: number | undefined): boolean {
	if (!Number.isInteger(pid) || !pid || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error
			? String((error as NodeJS.ErrnoException).code) === "EPERM"
			: false;
	}
}

export function createHubAuthToken(): string {
	return randomBytes(32).toString("hex");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHubLockDir(lockBasis: string): string {
	return `${lockBasis}.lock`;
}

async function readHubLockRecord(
	lockDir: string,
): Promise<{ pid: number; acquiredAt: string } | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(join(lockDir, "owner.json"), "utf8"),
		) as Partial<{ pid: number; acquiredAt: string }>;
		if (
			typeof parsed.pid !== "number" ||
			typeof parsed.acquiredAt !== "string"
		) {
			return undefined;
		}
		return { pid: parsed.pid, acquiredAt: parsed.acquiredAt };
	} catch {
		return undefined;
	}
}

async function removeHubLock(lockDir: string): Promise<void> {
	await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
}

export function resolveHubBuildId(): string {
	const configured = process.env[HUB_BUILD_ID_ENV]?.trim();
	if (configured) {
		return configured;
	}
	const embedded =
		typeof __CLINE_CORE_RUNTIME_BUILD_ID__ === "string"
			? __CLINE_CORE_RUNTIME_BUILD_ID__.trim()
			: "";
	return embedded || `source-${String(corePackage.version)}`;
}

export type ManagedHubCompatibilityResult =
	| { compatible: true }
	| {
			compatible: false;
			reason:
				| Exclude<HubCompatibilityResult, { compatible: true }>["reason"]
				| "missing_build"
				| "build_mismatch";
	  };

/**
 * Compatibility for a managed local Hub discovered through Cline's owner
 * record. Unlike explicit endpoints, a managed Hub is code that this client
 * is responsible for keeping current, so wire compatibility alone is not
 * enough: reusing a daemon from another build would keep executing stale
 * runtime, scheduler, connector, and command-handler code after an upgrade.
 */
export function getManagedHubCompatibility(
	record: HubProtocolMetadata & { buildId?: string },
	expectedBuildId = resolveHubBuildId(),
): ManagedHubCompatibilityResult {
	const protocol = isHubProtocolCompatible(record);
	if (!protocol.compatible) {
		return protocol;
	}
	const buildId = record.buildId?.trim();
	if (!buildId) {
		return { compatible: false, reason: "missing_build" };
	}
	if (buildId !== expectedBuildId) {
		return { compatible: false, reason: "build_mismatch" };
	}
	return { compatible: true };
}

export function resolveHubOwnerContext(
	ownerBasis: string = process.argv[1]?.trim() || process.cwd(),
): HubOwnerContext {
	const ownerId = `hub-${hashValue(ownerBasis)}`;
	const discoveryPath =
		process.env[HUB_DISCOVERY_ENV]?.trim() ||
		join(
			resolveClineDataDir(),
			"locks",
			"hub",
			"owners",
			`${sanitizeKey(ownerId)}.json`,
		);
	return { ownerId, discoveryPath };
}

export function createInMemoryHubOwnerContext(
	label = `hub-${Date.now().toString(36)}`,
): HubOwnerContext {
	return resolveHubOwnerContext(label);
}

export async function readHubDiscovery(
	discoveryPath: string,
): Promise<HubServerDiscoveryRecord | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(discoveryPath, "utf8"),
		) as Partial<HubServerDiscoveryRecord>;
		if (
			typeof parsed.hubId !== "string" ||
			typeof parsed.protocolVersion !== "string" ||
			typeof parsed.authToken !== "string" ||
			typeof parsed.host !== "string" ||
			typeof parsed.port !== "number" ||
			typeof parsed.url !== "string" ||
			typeof parsed.startedAt !== "string" ||
			typeof parsed.updatedAt !== "string"
		) {
			return undefined;
		}
		return {
			hubId: parsed.hubId,
			protocolVersion: parsed.protocolVersion,
			minClientProtocolVersion:
				typeof parsed.minClientProtocolVersion === "string"
					? parsed.minClientProtocolVersion
					: undefined,
			maxClientProtocolVersion:
				typeof parsed.maxClientProtocolVersion === "string"
					? parsed.maxClientProtocolVersion
					: undefined,
			capabilities: Array.isArray(parsed.capabilities)
				? parsed.capabilities.filter(
						(capability): capability is string =>
							typeof capability === "string",
					)
				: undefined,
			coreVersion:
				typeof parsed.coreVersion === "string" ? parsed.coreVersion : undefined,
			buildId: typeof parsed.buildId === "string" ? parsed.buildId : undefined,
			authToken: parsed.authToken,
			host: parsed.host,
			port: parsed.port,
			url: parsed.url,
			pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
			startedAt: parsed.startedAt,
			updatedAt: parsed.updatedAt,
		};
	} catch {
		return undefined;
	}
}

export async function writeHubDiscovery(
	discoveryPath: string,
	record: HubServerDiscoveryRecord,
): Promise<void> {
	await withHubDiscoveryMutationLock(discoveryPath, async () => {
		const directory = dirname(discoveryPath);
		await mkdir(directory, { recursive: true });
		const temporaryPath = `${discoveryPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
		let temporaryFile: Awaited<ReturnType<typeof open>> | undefined;
		try {
			temporaryFile = await open(temporaryPath, "wx", 0o600);
			await temporaryFile.writeFile(`${JSON.stringify(record, null, 2)}\n`, {
				encoding: "utf8",
			});
			await temporaryFile.sync();
			await temporaryFile.close();
			temporaryFile = undefined;
			// On local filesystems with atomic same-directory rename semantics, this
			// prevents readers from observing the old remove/write gap and preserves
			// the previous complete record if publication fails.
			await rename(temporaryPath, discoveryPath);
			// Persist the rename where directory fsync is supported. Windows and
			// some virtual filesystems reject opening directories, so durability
			// there remains best-effort while the replacement itself stays atomic.
			let directoryHandle: Awaited<ReturnType<typeof open>> | undefined;
			try {
				directoryHandle = await open(directory, "r");
				await directoryHandle.sync();
			} catch {
				// Best-effort durability only; the discovery record is already valid.
			} finally {
				await directoryHandle?.close().catch(() => undefined);
			}
		} catch (error) {
			await temporaryFile?.close().catch(() => undefined);
			await rm(temporaryPath, { force: true }).catch(() => undefined);
			throw error;
		}
	});
}

export async function clearHubDiscovery(discoveryPath: string): Promise<void> {
	await withHubDiscoveryMutationLock(discoveryPath, async () => {
		await rm(discoveryPath, { force: true }).catch(() => undefined);
	});
}

export async function clearHubDiscoveryIfOwned(
	discoveryPath: string,
	hubId: string,
): Promise<boolean> {
	return await withHubDiscoveryMutationLock(discoveryPath, async () => {
		const current = await readHubDiscovery(discoveryPath);
		if (current?.hubId !== hubId) {
			return false;
		}
		await rm(discoveryPath, { force: true });
		return true;
	});
}

async function withHubLock<T>(
	lockBasis: string,
	label: string,
	callback: () => Promise<T>,
): Promise<T> {
	const lockDir = getHubLockDir(lockBasis);
	await mkdir(dirname(lockDir), { recursive: true });
	const deadline = Date.now() + HUB_STARTUP_LOCK_WAIT_MS;

	while (true) {
		try {
			await mkdir(lockDir, { recursive: false });
		} catch (error) {
			const code =
				error instanceof Error && "code" in error
					? String((error as NodeJS.ErrnoException).code)
					: "";
			if (code !== "EEXIST") {
				throw error;
			}
			const record = await readHubLockRecord(lockDir);
			if (!record) {
				// The winner creates the directory before it can publish owner.json.
				// Do not steal that initialization window. A genuinely abandoned
				// empty lock is reclaimed only after the bounded wait.
				if (Date.now() >= deadline) {
					await removeHubLock(lockDir);
					continue;
				}
				await sleep(HUB_STARTUP_LOCK_POLL_MS);
				continue;
			}
			const lockAge = Date.now() - Date.parse(record.acquiredAt);
			if (!isPidAlive(record.pid) || lockAge > HUB_STARTUP_LOCK_MAX_AGE_MS) {
				await removeHubLock(lockDir);
				continue;
			}
			if (Date.now() >= deadline) {
				throw new Error(`Timed out waiting for hub ${label} lock ${lockDir}`);
			}
			await sleep(HUB_STARTUP_LOCK_POLL_MS);
			continue;
		}

		try {
			await writeFile(
				join(lockDir, "owner.json"),
				`${JSON.stringify(
					{ pid: process.pid, acquiredAt: new Date().toISOString() },
					null,
					2,
				)}\n`,
				"utf8",
			);
			return await callback();
		} finally {
			await removeHubLock(lockDir);
		}
	}
}

function withHubDiscoveryMutationLock<T>(
	discoveryPath: string,
	callback: () => Promise<T>,
): Promise<T> {
	return withHubLock(
		`${discoveryPath}.mutation`,
		"discovery mutation",
		callback,
	);
}

export function withHubStartupLock<T>(
	discoveryPath: string,
	callback: () => Promise<T>,
): Promise<T> {
	return withHubLock(discoveryPath, "startup", callback);
}

export async function probeHubServer(
	url: string,
	options?: { authToken?: string },
): Promise<HubServerProbeRecord | undefined> {
	try {
		const response = await fetch(
			options?.authToken ? toHubStatusUrl(url) : toHubHealthUrl(url),
			{
				headers: options?.authToken
					? { authorization: `Bearer ${options.authToken}` }
					: undefined,
			},
		);
		if (!response.ok) {
			return undefined;
		}
		const parsed = (await response.json()) as Partial<HubServerProbeRecord>;
		if (
			typeof parsed.protocolVersion !== "string" ||
			typeof parsed.host !== "string" ||
			typeof parsed.port !== "number" ||
			typeof parsed.url !== "string"
		) {
			return undefined;
		}
		return {
			protocolVersion: parsed.protocolVersion,
			minClientProtocolVersion:
				typeof parsed.minClientProtocolVersion === "string"
					? parsed.minClientProtocolVersion
					: undefined,
			maxClientProtocolVersion:
				typeof parsed.maxClientProtocolVersion === "string"
					? parsed.maxClientProtocolVersion
					: undefined,
			capabilities: Array.isArray(parsed.capabilities)
				? parsed.capabilities.filter(
						(capability): capability is string =>
							typeof capability === "string",
					)
				: undefined,
			coreVersion:
				typeof parsed.coreVersion === "string" ? parsed.coreVersion : undefined,
			buildId: typeof parsed.buildId === "string" ? parsed.buildId : undefined,
			host: parsed.host,
			port: parsed.port,
			url: parsed.url,
			hubId: typeof parsed.hubId === "string" ? parsed.hubId : undefined,
			authToken:
				typeof parsed.authToken === "string" ? parsed.authToken : undefined,
			pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
			startedAt:
				typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
			updatedAt:
				typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
		};
	} catch {
		return undefined;
	}
}

export function createHubServerUrl(
	host: string,
	port: number,
	pathname = "/hub",
): string {
	return new URL(`ws://${host}:${port}${pathname}`).toString();
}

export function toHubHealthUrl(wsUrl: string): string {
	const parsed = new URL(wsUrl);
	parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
	parsed.pathname = "/health";
	parsed.search = "";
	return parsed.toString();
}

export function toHubStatusUrl(wsUrl: string): string {
	const parsed = new URL(toHubHealthUrl(wsUrl));
	parsed.pathname = "/status";
	return parsed.toString();
}

export function isDiscoveryFilePresent(pathname: string): boolean {
	return existsSync(pathname);
}

export { resolveClineDataDir, resolveClineDir };
