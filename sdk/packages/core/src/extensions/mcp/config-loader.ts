import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BasicLogger } from "@cline/shared";
import { resolveMcpSettingsPath } from "@cline/shared/storage";
import { z } from "zod";
import type {
	McpManager,
	McpServerOAuthState,
	McpServerOAuthStatus,
	McpServerRegistration,
} from "./types";

const stringRecordSchema = z.record(z.string(), z.string());
const metadataSchema = z.record(z.string(), z.unknown());
const oauthStateSchema = z
	.object({
		clientInformation: z.record(z.string(), z.unknown()).optional(),
		tokens: z.record(z.string(), z.unknown()).optional(),
		codeVerifier: z.string().optional(),
		discoveryState: z.record(z.string(), z.unknown()).optional(),
		redirectUrl: z.string().url().optional(),
		lastError: z.string().optional(),
		lastAuthenticatedAt: z.number().int().positive().optional(),
	})
	.strip();

const stdioTransportSchema = z.object({
	type: z.literal("stdio"),
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	cwd: z.string().min(1).optional(),
	env: stringRecordSchema.optional(),
});

const sseTransportSchema = z.object({
	type: z.literal("sse"),
	url: z.string().url(),
	headers: stringRecordSchema.optional(),
});

const streamableHttpTransportSchema = z.object({
	type: z.literal("streamableHttp"),
	url: z.string().url(),
	headers: stringRecordSchema.optional(),
});

const mcpTransportSchema = z.discriminatedUnion("type", [
	stdioTransportSchema,
	sseTransportSchema,
	streamableHttpTransportSchema,
]);

const nestedRegistrationBodySchema = z.object({
	transport: mcpTransportSchema,
	disabled: z.boolean().optional(),
	metadata: metadataSchema.optional(),
	oauth: oauthStateSchema.optional(),
	initializeTimeoutMs: z.number().int().min(100).optional(),
});

const legacyTransportTypeSchema = z
	.enum(["stdio", "sse", "http", "streamableHttp"])
	.optional();

const legacyRegistrationBaseSchema = z.object({
	type: z.enum(["stdio", "sse", "streamableHttp"]).optional(),
	transportType: legacyTransportTypeSchema,
	disabled: z.boolean().optional(),
	metadata: metadataSchema.optional(),
	oauth: oauthStateSchema.optional(),
	initializeTimeoutMs: z.number().int().min(100).optional(),
});

function mapLegacyTransportType(
	transportType: z.infer<typeof legacyTransportTypeSchema>,
): "stdio" | "sse" | "streamableHttp" | undefined {
	if (!transportType) {
		return undefined;
	}
	if (transportType === "http") {
		return "streamableHttp";
	}
	return transportType;
}

const legacyStdioRegistrationSchema = legacyRegistrationBaseSchema
	.extend({
		command: z.string().min(1),
		args: z.array(z.string()).optional(),
		cwd: z.string().min(1).optional(),
		env: stringRecordSchema.optional(),
	})
	.superRefine((value, ctx) => {
		const resolvedType =
			value.type ?? mapLegacyTransportType(value.transportType);
		if (resolvedType && resolvedType !== "stdio") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Expected type "stdio" for command-based MCP server',
				path: ["type"],
			});
		}
	})
	.transform((value) => ({
		transport: {
			type: "stdio" as const,
			command: value.command,
			args: value.args,
			cwd: value.cwd,
			env: value.env,
		},
		disabled: value.disabled,
		metadata: value.metadata,
		oauth: value.oauth,
		initializeTimeoutMs: value.initializeTimeoutMs,
	}));

const legacyUrlRegistrationSchema = legacyRegistrationBaseSchema
	.extend({
		url: z.string().url(),
		headers: stringRecordSchema.optional(),
	})
	.superRefine((value, ctx) => {
		const resolvedType =
			value.type ?? mapLegacyTransportType(value.transportType) ?? "sse";
		if (resolvedType !== "sse" && resolvedType !== "streamableHttp") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					'Expected type "sse" or "streamableHttp" for URL-based MCP server',
				path: ["type"],
			});
		}
	})
	.transform((value) => {
		const resolvedType =
			value.type ?? mapLegacyTransportType(value.transportType) ?? "sse";
		if (resolvedType === "streamableHttp") {
			return {
				transport: {
					type: "streamableHttp" as const,
					url: value.url,
					headers: value.headers,
				},
				disabled: value.disabled,
				metadata: value.metadata,
				oauth: value.oauth,
				initializeTimeoutMs: value.initializeTimeoutMs,
			};
		}
		return {
			transport: {
				type: "sse" as const,
				url: value.url,
				headers: value.headers,
			},
			disabled: value.disabled,
			metadata: value.metadata,
			oauth: value.oauth,
			initializeTimeoutMs: value.initializeTimeoutMs,
		};
	});

const mcpRegistrationBodySchema = z.union([
	nestedRegistrationBodySchema,
	legacyStdioRegistrationSchema,
	legacyUrlRegistrationSchema,
]);

const mcpSettingsSchema = z
	.object({
		mcpServers: z.record(z.string(), mcpRegistrationBodySchema),
	})
	.passthrough();

export interface McpSettingsFile {
	mcpServers: Record<string, Omit<McpServerRegistration, "name">>;
}

export interface LoadMcpSettingsOptions {
	filePath?: string;
}

export interface RegisterMcpServersFromSettingsOptions {
	filePath?: string;
}

export interface SetMcpServerDisabledOptions {
	filePath?: string;
	name: string;
	disabled: boolean;
}

export interface McpSettingsLockOptions {
	/** Maximum time to wait for the lock before failing. Defaults to 10 seconds. */
	timeoutMs?: number;
	/** Optional host logger; stale-lock takeover is logged as severity=warn. */
	logger?: BasicLogger;
}

export type McpSettingsMutator<T> = (settings: Record<string, unknown>) => T;

export class McpSettingsUpdateSkippedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpSettingsUpdateSkippedError";
	}
}

export class McpSettingsLockTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpSettingsLockTimeoutError";
	}
}

export class McpSettingsMutatorPurityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpSettingsMutatorPurityError";
	}
}

export function resolveDefaultMcpSettingsPath(): string {
	return resolveMcpSettingsPath();
}

/**
 * Atomically write the MCP settings file using a temp file + rename.
 *
 * Multiple processes (CLI, VSCode extension windows, JetBrains) read and write
 * this file concurrently. A plain writeFileSync can be observed half-written by
 * a concurrent reader, surfacing as a JSON parse error or, for a client that
 * treats an unreadable file as "no servers", silently dropping MCP state.
 * Rename within the same directory is atomic on POSIX and on NTFS, so a reader
 * always observes either the old or the new complete file.
 */
function atomicWriteSettingsFile(filePath: string, contents: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random()
		.toString(36)
		.slice(2)}`;
	try {
		writeFileSync(tempPath, contents, { encoding: "utf8", flag: "wx" });
		renameSync(tempPath, filePath);
	} catch (error) {
		try {
			unlinkSync(tempPath);
		} catch {
			// Best-effort cleanup of the temp file.
		}
		throw error;
	}
}

/**
 * How long (ms) a lock directory may exist before it is considered stale and
 * forcibly reclaimed. A real critical section here is a handful of synchronous
 * file ops (sub-millisecond), so this is orders of magnitude larger than any
 * legitimate hold. A lock older than this can only mean the owner crashed or
 * was killed mid-update, so taking it over prevents a permanent deadlock.
 */
const SETTINGS_LOCK_STALE_MS = 10_000;

/** Poll interval (ms) while waiting for another process to release the lock. */
const SETTINGS_LOCK_POLL_MS = 25;

const syncSleepBuffer = new Int32Array(new SharedArrayBuffer(4));

/**
 * Lock directories this process currently holds. The on-disk lock is not
 * reentrant, so a settings update whose file is already locked by this process
 * throws rather than waiting. Both acquisition paths register here.
 */
const activeLocks = new Set<string>();

function sleepSync(ms: number): void {
	Atomics.wait(syncSleepBuffer, 0, 0, ms);
}

function settingsLockDir(filePath: string): string {
	return `${filePath}.lock`;
}

function makeLockToken(): string {
	return `${process.pid}.${Date.now()}.${randomUUID()}`;
}

interface AcquiredSettingsLock {
	lockDir: string;
	ownerFile: string;
}

/**
 * Cross-process lock implemented as a populated directory. Acquisition creates a
 * staging directory, writes a unique owner marker inside it, then renames the
 * populated directory into place. That means the visible lock directory is never
 * empty. Release only deletes our marker and then rmdir's the directory; if
 * another owner replaced the lock, our marker is absent or the directory is
 * non-empty, so we do not remove their lock. Stale takeover renames the whole
 * lock directory aside before deleting it. This uses standard mkdir/rename/rmdir
 * operations and avoids inode- or handle-based deletion, so it works with
 * Node's portable fs APIs on Windows and POSIX.
 */
function tryAcquireSettingsLock(
	lockDir: string,
	token: string,
): AcquiredSettingsLock | undefined {
	mkdirSync(dirname(lockDir), { recursive: true });
	const stagingDir = `${lockDir}.tmp.${token}`;
	rmSync(stagingDir, { recursive: true, force: true });
	mkdirSync(stagingDir, { recursive: true });
	writeFileSync(join(stagingDir, `owner.${token}`), token, {
		encoding: "utf8",
		flag: "wx",
	});
	try {
		renameSync(stagingDir, lockDir);
		return { lockDir, ownerFile: join(lockDir, `owner.${token}`) };
	} catch (error) {
		rmSync(stagingDir, { recursive: true, force: true });
		if (existsSync(lockDir)) {
			return undefined;
		}
		throw error;
	}
}

function reclaimStaleLock(
	lockDir: string,
	options: McpSettingsLockOptions,
): void {
	let ageMs: number;
	try {
		ageMs = Date.now() - statSync(lockDir).mtimeMs;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return;
		}
		throw error;
	}
	if (ageMs < SETTINGS_LOCK_STALE_MS) {
		return;
	}
	options.logger?.log(
		`[mcp-settings] Stale lock directory at ${lockDir} (age ${ageMs}ms); reclaiming.`,
		{
			severity: "warn",
		},
	);
	const staleDir = `${lockDir}.stale.${makeLockToken()}`;
	try {
		renameSync(lockDir, staleDir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return;
		}
		throw error;
	}
	rmSync(staleDir, { recursive: true, force: true });
}

function releaseSettingsLock(lock: AcquiredSettingsLock): void {
	try {
		unlinkSync(lock.ownerFile);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
	try {
		rmdirSync(lock.lockDir);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") {
			throw error;
		}
	}
}

function beginAcquire(filePath: string): { lockDir: string; token: string } {
	const lockDir = settingsLockDir(filePath);
	if (activeLocks.has(lockDir)) {
		throw new Error(
			`Reentrant MCP settings update for ${filePath}. Keep mutators pure: compute values up front and do not call back into the settings API.`,
		);
	}
	return { lockDir, token: makeLockToken() };
}

function acquireSettingsLockSync(
	filePath: string,
	options: McpSettingsLockOptions,
): AcquiredSettingsLock {
	const { lockDir, token } = beginAcquire(filePath);
	const timeoutMs = options.timeoutMs ?? SETTINGS_LOCK_STALE_MS;
	const startedAt = Date.now();
	while (true) {
		const lock = tryAcquireSettingsLock(lockDir, token);
		if (lock) {
			activeLocks.add(lockDir);
			return lock;
		}
		if (Date.now() - startedAt > timeoutMs) {
			throw new McpSettingsLockTimeoutError(
				`Timed out waiting for MCP settings lock at ${lockDir} after ${timeoutMs}ms.`,
			);
		}
		reclaimStaleLock(lockDir, options);
		sleepSync(SETTINGS_LOCK_POLL_MS);
	}
}

/**
 * Acquire the settings lock, yielding the event loop (`await delay`) between
 * attempts. Reclaims a stale lock left by a crashed holder and throws
 * McpSettingsLockTimeoutError once `timeoutMs` elapses.
 */
async function acquireSettingsLockAsync(
	filePath: string,
	options: McpSettingsLockOptions,
): Promise<AcquiredSettingsLock> {
	const { lockDir, token } = beginAcquire(filePath);
	const timeoutMs = options.timeoutMs ?? SETTINGS_LOCK_STALE_MS;
	const startedAt = Date.now();
	while (true) {
		const lock = tryAcquireSettingsLock(lockDir, token);
		if (lock) {
			activeLocks.add(lockDir);
			return lock;
		}
		if (Date.now() - startedAt > timeoutMs) {
			throw new McpSettingsLockTimeoutError(
				`Timed out waiting for MCP settings lock at ${lockDir} after ${timeoutMs}ms.`,
			);
		}
		reclaimStaleLock(lockDir, options);
		await delay(SETTINGS_LOCK_POLL_MS);
	}
}

/**
 * Run the read-modify-write while the lock is held. The body is synchronous and
 * never yields, so a concurrent waiter cannot interleave between the read and
 * the write, and the lock is released the moment the mutation completes.
 */
function runLockedSettingsMutation<T>(
	lock: AcquiredSettingsLock,
	filePath: string,
	mutator: McpSettingsMutator<T>,
): T {
	try {
		const settings = loadRawSettingsObject(filePath);
		const result = runPureSettingsMutator(settings, mutator);
		atomicWriteSettingsFile(filePath, `${JSON.stringify(settings, null, 2)}\n`);
		return result;
	} finally {
		activeLocks.delete(lock.lockDir);
		releaseSettingsLock(lock);
	}
}

/**
 * Locked MCP settings read-modify-write that blocks the event loop (via
 * `Atomics.wait`) while acquiring the lock.
 *
 * Prefer {@link updateMcpSettingsFile}: async acquisition keeps the event loop
 * free and behaves identically otherwise.
 *
 * TODO: Delete once all callers migrate to {@link updateMcpSettingsFile}.
 *
 * The mutator is synchronous and may be called more than once with the same
 * input to verify it is pure/deterministic. Compute any I/O, logging, network,
 * timestamp, or random values before calling and close over them. Return a value
 * only for a successful update; throw McpSettingsUpdateSkippedError to skip.
 */
export function updateMcpSettingsFileSync<T>(
	filePath: string,
	mutator: McpSettingsMutator<T>,
	options: McpSettingsLockOptions = {},
): T {
	const lock = acquireSettingsLockSync(filePath, options);
	return runLockedSettingsMutation(lock, filePath, mutator);
}

/**
 * Locked MCP settings read-modify-write that yields the event loop while
 * acquiring the lock, so concurrent work on the same loop keeps running.
 *
 * The mutator is synchronous and may be called more than once with the same
 * input to verify it is pure/deterministic. Compute any I/O, logging, network,
 * timestamp, or random values before calling and close over them. The lock is
 * held only across the synchronous mutation, never across an `await`. Return a
 * value only for a successful update; throw McpSettingsUpdateSkippedError to skip.
 */
export async function updateMcpSettingsFile<T>(
	filePath: string,
	mutator: McpSettingsMutator<T>,
	options: McpSettingsLockOptions = {},
): Promise<T> {
	const lock = await acquireSettingsLockAsync(filePath, options);
	return runLockedSettingsMutation(lock, filePath, mutator);
}

/**
 * Read the settings object for a locked read-modify-write. A missing file
 * bootstraps to `{ mcpServers: {} }`, so the first write to a fresh path creates
 * the file inside the lock instead of throwing. The subsequent atomic write
 * persists it.
 */
function loadRawSettingsObject(filePath: string): Record<string, unknown> {
	const settings = readJsonObjectOrEmpty(filePath);
	if (
		!settings.mcpServers ||
		typeof settings.mcpServers !== "object" ||
		Array.isArray(settings.mcpServers)
	) {
		settings.mcpServers = {};
	}
	return settings;
}

function runPureSettingsMutator<T>(
	settings: Record<string, unknown>,
	mutator: McpSettingsMutator<T>,
): T {
	const before = JSON.stringify(settings);
	const shadow = JSON.parse(before) as Record<string, unknown>;
	const shadowResult = mutator(shadow);
	const shadowAfter = JSON.stringify(shadow);
	const result = mutator(settings);
	const after = JSON.stringify(settings);
	if (after !== shadowAfter) {
		throw new McpSettingsMutatorPurityError(
			"MCP settings mutator must be deterministic and free of side effects; repeated calls produced different settings.",
		);
	}
	if (JSON.stringify(result) !== JSON.stringify(shadowResult)) {
		throw new McpSettingsMutatorPurityError(
			"MCP settings mutator must be deterministic and free of side effects; repeated calls produced different return values.",
		);
	}
	return result;
}

function readJsonObject(filePath: string): Record<string, unknown> {
	const raw = readFileSync(filePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to parse MCP settings JSON at "${filePath}": ${details}`,
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid MCP settings at "${filePath}": expected object.`);
	}
	return parsed as Record<string, unknown>;
}

/**
 * Like {@link readJsonObject}, but treats a missing file as an empty object so a
 * locked write can create it. A present-but-malformed file still throws.
 */
function readJsonObjectOrEmpty(filePath: string): Record<string, unknown> {
	try {
		return readJsonObject(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {};
		}
		throw error;
	}
}

function getOwnServerRecord(
	servers: Record<string, unknown>,
	name: string,
): Record<string, unknown> | undefined {
	if (!Object.hasOwn(servers, name)) {
		return undefined;
	}
	const value = servers[name];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function setOwnServerRecord(
	servers: Record<string, unknown>,
	name: string,
	value: Record<string, unknown>,
): void {
	Object.defineProperty(servers, name, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

export function loadMcpSettingsFile(
	options: LoadMcpSettingsOptions = {},
): McpSettingsFile {
	const filePath = options.filePath ?? resolveDefaultMcpSettingsPath();
	const raw = readFileSync(filePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to parse MCP settings JSON at "${filePath}": ${details}`,
		);
	}
	const result = mcpSettingsSchema.safeParse(parsed);
	if (!result.success) {
		const details = result.error.issues
			.map((issue) => {
				const path = issue.path.join(".");
				return path ? `${path}: ${issue.message}` : issue.message;
			})
			.join("; ");
		throw new Error(`Invalid MCP settings at "${filePath}": ${details}`);
	}
	return result.data;
}

export function normalizeMcpServerOAuthState(
	value: McpServerOAuthState | undefined,
): McpServerOAuthState | undefined {
	if (!value) {
		return undefined;
	}
	const normalized: McpServerOAuthState = {
		...(value.clientInformation
			? { clientInformation: value.clientInformation }
			: {}),
		...(value.tokens ? { tokens: value.tokens } : {}),
		...(value.codeVerifier ? { codeVerifier: value.codeVerifier } : {}),
		...(value.discoveryState ? { discoveryState: value.discoveryState } : {}),
		...(value.redirectUrl ? { redirectUrl: value.redirectUrl } : {}),
		...(value.lastError ? { lastError: value.lastError } : {}),
		...(value.lastAuthenticatedAt
			? { lastAuthenticatedAt: value.lastAuthenticatedAt }
			: {}),
	};
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function validateOauthState(value: unknown): McpServerOAuthState | undefined {
	if (value === undefined) {
		return undefined;
	}
	const result = oauthStateSchema.safeParse(value);
	if (!result.success) {
		return undefined;
	}
	return normalizeMcpServerOAuthState(result.data);
}

export function hasMcpSettingsFile(
	options: LoadMcpSettingsOptions = {},
): boolean {
	const filePath = options.filePath ?? resolveDefaultMcpSettingsPath();
	return existsSync(filePath);
}

export function resolveMcpServerRegistrations(
	options: LoadMcpSettingsOptions = {},
): McpServerRegistration[] {
	const config = loadMcpSettingsFile(options);
	return Object.entries(config.mcpServers).map(([name, value]) => ({
		name,
		transport: value.transport,
		disabled: value.disabled,
		metadata: value.metadata,
		oauth: value.oauth,
		initializeTimeoutMs: value.initializeTimeoutMs,
	}));
}

export function setMcpServerDisabled(
	options: SetMcpServerDisabledOptions,
): void {
	const filePath = options.filePath ?? resolveDefaultMcpSettingsPath();
	const name = options.name.trim();
	if (!name) {
		throw new Error("MCP server settings toggle requires a server name.");
	}
	updateMcpSettingsFileSync(filePath, (settings) => {
		const serversValue = settings.mcpServers;
		if (
			!serversValue ||
			typeof serversValue !== "object" ||
			Array.isArray(serversValue)
		) {
			throw new Error(
				`Invalid MCP settings at "${filePath}": mcpServers must be an object.`,
			);
		}
		const servers = { ...(serversValue as Record<string, unknown>) };
		const current = getOwnServerRecord(servers, name);
		if (!current) {
			throw new Error(`Unknown MCP server: ${name}`);
		}
		const next = { ...current };
		if (options.disabled) {
			next.disabled = true;
		} else {
			delete next.disabled;
		}
		setOwnServerRecord(servers, name, next);
		settings.mcpServers = servers;
	});
}

export function getMcpServerOAuthState(
	serverName: string,
	options: LoadMcpSettingsOptions = {},
): McpServerOAuthState | undefined {
	const config = loadMcpSettingsFile(options);
	if (!Object.hasOwn(config.mcpServers, serverName)) {
		return undefined;
	}
	return normalizeMcpServerOAuthState(config.mcpServers[serverName]?.oauth);
}

function buildOAuthStateMutator(
	serverName: string,
	updater: (current: McpServerOAuthState) => McpServerOAuthState,
): McpSettingsMutator<McpServerOAuthState> {
	return (settings) => {
		const servers = settings.mcpServers as Record<string, unknown>;
		const server = getOwnServerRecord(servers, serverName);
		if (!server) {
			throw new Error(`Unknown MCP server: ${serverName}`);
		}

		const current = validateOauthState(server.oauth) ?? {};
		const updated = normalizeMcpServerOAuthState(updater(current));
		if (updated) {
			server.oauth = updated;
		} else {
			delete server.oauth;
		}
		return updated ?? {};
	};
}

/**
 * Scoped read-modify-write of one server's `oauth` block that blocks the event
 * loop while acquiring the lock.
 *
 * Prefer {@link updateMcpServerOAuthStateAsync}.
 *
 * TODO: Delete once all callers migrate to {@link updateMcpServerOAuthStateAsync}.
 */
export function updateMcpServerOAuthState(
	serverName: string,
	updater: (current: McpServerOAuthState) => McpServerOAuthState,
	options: LoadMcpSettingsOptions = {},
): McpServerOAuthState {
	const filePath = options.filePath ?? resolveDefaultMcpSettingsPath();
	return updateMcpSettingsFileSync(
		filePath,
		buildOAuthStateMutator(serverName, updater),
	);
}

/**
 * Scoped read-modify-write of one server's `oauth` block that yields the event
 * loop while acquiring the lock. The updater is synchronous and pure; it
 * receives the server's current OAuth state and returns the next state.
 */
export async function updateMcpServerOAuthStateAsync(
	serverName: string,
	updater: (current: McpServerOAuthState) => McpServerOAuthState,
	options: LoadMcpSettingsOptions = {},
): Promise<McpServerOAuthState> {
	const filePath = options.filePath ?? resolveDefaultMcpSettingsPath();
	return updateMcpSettingsFile(
		filePath,
		buildOAuthStateMutator(serverName, updater),
	);
}

export function listMcpServerOAuthStatuses(
	options: LoadMcpSettingsOptions = {},
): McpServerOAuthStatus[] {
	const registrations = resolveMcpServerRegistrations(options);
	return registrations
		.map((registration) => {
			const oauthSupported = registration.transport.type !== "stdio";
			const accessToken = registration.oauth?.tokens?.access_token;
			return {
				serverName: registration.name,
				oauthSupported,
				oauthConfigured:
					oauthSupported &&
					typeof accessToken === "string" &&
					accessToken.trim().length > 0,
				lastError: registration.oauth?.lastError,
				lastAuthenticatedAt: registration.oauth?.lastAuthenticatedAt,
			};
		})
		.sort((left, right) => left.serverName.localeCompare(right.serverName));
}

export async function registerMcpServersFromSettingsFile(
	manager: Pick<McpManager, "registerServer">,
	options: RegisterMcpServersFromSettingsOptions = {},
): Promise<McpServerRegistration[]> {
	const registrations = resolveMcpServerRegistrations(options);
	for (const registration of registrations) {
		await manager.registerServer(registration);
	}
	return registrations;
}
