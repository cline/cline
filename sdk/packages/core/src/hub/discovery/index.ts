import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveClineDataDir, resolveClineDir } from "@cline/shared/storage";
import corePackage from "../../../package.json";

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
	const configured = process.env.CLINE_HUB_AUTH_TOKEN?.trim();
	return configured || "";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStartupLockDir(discoveryPath: string): string {
	return `${discoveryPath}.lock`;
}

async function readStartupLockRecord(
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

async function removeStartupLock(lockDir: string): Promise<void> {
	await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
}

export function resolveHubBuildId(): string {
	return process.env[HUB_BUILD_ID_ENV]?.trim() || String(corePackage.version);
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
	await mkdir(dirname(discoveryPath), { recursive: true });
	// Remove any existing file first so writeFile creates it fresh with the
	// correct mode. On Linux, the mode option is ignored for existing files.
	await rm(discoveryPath, { force: true }).catch(() => undefined);
	await writeFile(discoveryPath, `${JSON.stringify(record, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(discoveryPath, 0o600);
}

export async function clearHubDiscovery(discoveryPath: string): Promise<void> {
	await rm(discoveryPath, { force: true }).catch(() => undefined);
}

export async function withHubStartupLock<T>(
	discoveryPath: string,
	callback: () => Promise<T>,
): Promise<T> {
	const lockDir = getStartupLockDir(discoveryPath);
	await mkdir(dirname(lockDir), { recursive: true });
	const deadline = Date.now() + HUB_STARTUP_LOCK_WAIT_MS;

	while (true) {
		try {
			await mkdir(lockDir, { recursive: false });
			await writeFile(
				join(lockDir, "owner.json"),
				`${JSON.stringify(
					{ pid: process.pid, acquiredAt: new Date().toISOString() },
					null,
					2,
				)}\n`,
				"utf8",
			);
			try {
				return await callback();
			} finally {
				await removeStartupLock(lockDir);
			}
		} catch (error) {
			const code =
				error instanceof Error && "code" in error
					? String((error as NodeJS.ErrnoException).code)
					: "";
			if (code !== "EEXIST") {
				throw error;
			}
			const record = await readStartupLockRecord(lockDir);
			const lockAge = record
				? Date.now() - Date.parse(record.acquiredAt)
				: HUB_STARTUP_LOCK_MAX_AGE_MS + 1;
			if (
				!record ||
				!isPidAlive(record.pid) ||
				lockAge > HUB_STARTUP_LOCK_MAX_AGE_MS
			) {
				await removeStartupLock(lockDir);
				continue;
			}
			if (Date.now() >= deadline) {
				throw new Error(`Timed out waiting for hub startup lock ${lockDir}`);
			}
			await sleep(HUB_STARTUP_LOCK_POLL_MS);
		}
	}
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
