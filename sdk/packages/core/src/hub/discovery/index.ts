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
declare const __CLINE_CORE_RUNTIME_BUILD_EPOCH_MS__: number | undefined;

const HUB_DISCOVERY_ENV = "CLINE_HUB_DISCOVERY_PATH";
const HUB_BUILD_ID_ENV = "CLINE_HUB_BUILD_ID";
const HUB_BUILD_EPOCH_ENV = "CLINE_HUB_BUILD_EPOCH_MS";
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
	buildEpochMs?: number;
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
	buildEpochMs?: number;
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

/**
 * When this SDK build was produced, embedded at bundle time. Orders builds so
 * managed-Hub handling can distinguish a newer daemon (attach and prompt the
 * user to update) from a stale one (retire and replace). Undefined when
 * running from unbundled sources, where no meaningful ordering exists.
 */
export function resolveHubBuildEpochMs(): number | undefined {
	const configured = Number(process.env[HUB_BUILD_EPOCH_ENV]);
	if (Number.isFinite(configured) && configured > 0) {
		return configured;
	}
	return typeof __CLINE_CORE_RUNTIME_BUILD_EPOCH_MS__ === "number" &&
		Number.isFinite(__CLINE_CORE_RUNTIME_BUILD_EPOCH_MS__)
		? __CLINE_CORE_RUNTIME_BUILD_EPOCH_MS__
		: undefined;
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

export interface HubBuildIdentity {
	buildId?: string;
	buildEpochMs?: number;
	coreVersion?: string;
}

function finiteEpochMs(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

/**
 * Numeric release components of a semver-ish version, ignoring any prerelease
 * or build suffix. Undefined when the value carries no comparable release.
 */
function parseReleaseComponents(
	version: string | undefined,
): number[] | undefined {
	const release = version?.trim().split(/[-+]/, 1)[0];
	if (!release) {
		return undefined;
	}
	const components = release.split(".").map((part) => Number(part));
	if (
		components.length === 0 ||
		components.some((part) => !Number.isInteger(part) || part < 0)
	) {
		return undefined;
	}
	return components;
}

function compareReleaseComponents(a: number[], b: number[]): number {
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const left = a[index] ?? 0;
		const right = b[index] ?? 0;
		if (left !== right) {
			return left < right ? -1 : 1;
		}
	}
	return 0;
}

/**
 * Total order over Hub builds: negative when `a` is older than `b`, positive
 * when newer, zero when the two are indistinguishable.
 *
 * The ordering is what keeps concurrent installations from replacing each
 * other's daemons. A one-sided "may I reuse this?" predicate lets both sides
 * answer no, and two clients then retire each other's Hub forever; a total
 * order is antisymmetric by construction, so at most one side can ever decide
 * to retire. Every tier below preserves that: a field decides only when both
 * records carry it, and the final fallback is "equal", which means reuse.
 *
 * Tiers, in order: identical build, embedded build epoch, core release
 * version, then build id as a deterministic tiebreak.
 */
export function compareHubBuilds(
	a: HubBuildIdentity,
	b: HubBuildIdentity,
): number {
	const buildIdA = a.buildId?.trim();
	const buildIdB = b.buildId?.trim();
	if (buildIdA && buildIdB && buildIdA === buildIdB) {
		return 0;
	}

	const epochA = finiteEpochMs(a.buildEpochMs);
	const epochB = finiteEpochMs(b.buildEpochMs);
	if (epochA !== undefined && epochB !== undefined && epochA !== epochB) {
		return epochA < epochB ? -1 : 1;
	}

	const releaseA = parseReleaseComponents(a.coreVersion);
	const releaseB = parseReleaseComponents(b.coreVersion);
	if (releaseA && releaseB) {
		const release = compareReleaseComponents(releaseA, releaseB);
		if (release !== 0) {
			return release;
		}
	}

	if (buildIdA && buildIdB && buildIdA !== buildIdB) {
		return buildIdA < buildIdB ? -1 : 1;
	}

	return 0;
}

/**
 * This build's own identity, in the same shape a daemon publishes into its
 * discovery record.
 *
 * Self and peer identities must be built from the same fields. Enriching only
 * the local side - filling in a `coreVersion` the wire record can omit, say -
 * makes a build's identity depend on which role it is playing, and two
 * installations then decide the comparison on different tiers and each
 * conclude that it is the newer one. Callers that need a synthetic identity
 * pass it verbatim rather than layering overrides onto this.
 */
export function resolveHubBuildIdentity(): HubBuildIdentity {
	return {
		buildId: resolveHubBuildId(),
		buildEpochMs: resolveHubBuildEpochMs(),
		coreVersion: String(corePackage.version),
	};
}

/**
 * Whether a client may keep using a managed local Hub instead of retiring it.
 *
 * A Hub is retired only when this client's build is *strictly newer* by
 * {@link compareHubBuilds}. Same build, newer Hub, and indistinguishable
 * builds all attach over the compatible wire protocol and let the
 * build-mismatch watcher prompt the user to update. Because the decision is
 * derived from a total order, two installations can never retire each other.
 *
 * Genuine protocol incompatibility is unaffected: those Hubs cannot be spoken
 * to at all and are still replaced.
 */
export function isManagedHubReusable(
	record: HubProtocolMetadata & HubBuildIdentity,
	options?: { self?: HubBuildIdentity },
): boolean {
	const self = options?.self ?? resolveHubBuildIdentity();
	const compatibility = getManagedHubCompatibility(record, self.buildId ?? "");
	if (compatibility.compatible) {
		return true;
	}
	if (
		compatibility.reason !== "build_mismatch" &&
		compatibility.reason !== "missing_build"
	) {
		return false;
	}
	return compareHubBuilds(self, record) <= 0;
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
			buildEpochMs:
				typeof parsed.buildEpochMs === "number"
					? parsed.buildEpochMs
					: undefined,
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
			buildEpochMs:
				typeof parsed.buildEpochMs === "number"
					? parsed.buildEpochMs
					: undefined,
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
