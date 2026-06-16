import { setTimeout as delay } from "node:timers/promises"
import { randomUUID } from "node:crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

const SETTINGS_LOCK_STALE_MS = 10_000
const SETTINGS_LOCK_POLL_MS = 25

export interface McpSettingsUpdateOptions {
	abortSignal?: AbortSignal
}

export type McpSettingsMutator<T> = (settings: Record<string, unknown>) => T

export class McpSettingsUpdateSkippedError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "McpSettingsUpdateSkippedError"
	}
}

export class McpSettingsLockAbortedError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "McpSettingsLockAbortedError"
	}
}

export class McpSettingsMutatorPurityError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "McpSettingsMutatorPurityError"
	}
}

function settingsLockDir(settingsPath: string): string {
	return `${settingsPath}.lock`
}

function makeLockToken(): string {
	return `${process.pid}.${Date.now()}.${randomUUID()}`
}

interface AcquiredSettingsLock {
	lockDir: string
	ownerFile: string
}

async function atomicWriteSettingsFile(settingsPath: string, contents: string): Promise<void> {
	const tempPath = `${settingsPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
	await fs.mkdir(path.dirname(settingsPath), { recursive: true })
	try {
		await fs.writeFile(tempPath, contents, { encoding: "utf-8", flag: "wx" })
		await fs.rename(tempPath, settingsPath)
	} catch (error) {
		await fs.unlink(tempPath).catch(() => {})
		throw error
	}
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
async function tryAcquireSettingsLock(lockDir: string, token: string): Promise<AcquiredSettingsLock | undefined> {
	await fs.mkdir(path.dirname(lockDir), { recursive: true })
	const stagingDir = `${lockDir}.tmp.${token}`
	await fs.rm(stagingDir, { recursive: true, force: true })
	await fs.mkdir(stagingDir, { recursive: true })
	const ownerFileName = `owner.${token}`
	const stagingOwnerFile = path.join(stagingDir, ownerFileName)
	await fs.writeFile(stagingOwnerFile, token, { encoding: "utf8", flag: "wx" })
	try {
		await fs.rename(stagingDir, lockDir)
		return { lockDir, ownerFile: path.join(lockDir, ownerFileName) }
	} catch (error) {
		await fs.rm(stagingDir, { recursive: true, force: true })
		try {
			await fs.access(lockDir)
			return undefined
		} catch {
			throw error
		}
	}
}

async function reclaimStaleLock(lockDir: string): Promise<void> {
	let ageMs: number
	try {
		ageMs = Date.now() - (await fs.stat(lockDir)).mtimeMs
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return
		}
		throw error
	}
	if (ageMs < SETTINGS_LOCK_STALE_MS) {
		return
	}
	Logger.warn(`[mcp-settings] Stale lock directory at ${lockDir} (age ${ageMs}ms); reclaiming.`)
	const staleDir = `${lockDir}.stale.${makeLockToken()}`
	try {
		await fs.rename(lockDir, staleDir)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return
		}
		throw error
	}
	await fs.rm(staleDir, { recursive: true, force: true })
}

async function releaseSettingsLock(lock: AcquiredSettingsLock): Promise<void> {
	await fs.unlink(lock.ownerFile).catch((error) => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
	})
	await fs.rmdir(lock.lockDir).catch((error) => {
		const code = (error as NodeJS.ErrnoException).code
		if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") {
			throw error
		}
	})
}

function checkAbort(signal: AbortSignal | undefined, lockDir: string): void {
	if (signal?.aborted) {
		throw new McpSettingsLockAbortedError(`Aborted waiting for MCP settings lock at ${lockDir}.`)
	}
}

async function readSettingsObject(settingsPath: string): Promise<Record<string, unknown>> {
	const content = await fs.readFile(settingsPath, "utf-8")
	const settings = JSON.parse(content) as Record<string, unknown>
	if (!settings.mcpServers || typeof settings.mcpServers !== "object" || Array.isArray(settings.mcpServers)) {
		settings.mcpServers = {}
	}
	return settings
}

function runPureSettingsMutator<T>(settings: Record<string, unknown>, mutator: McpSettingsMutator<T>): T {
	const before = JSON.stringify(settings)
	const shadow = JSON.parse(before) as Record<string, unknown>
	const shadowResult = mutator(shadow)
	const shadowAfter = JSON.stringify(shadow)
	const result = mutator(settings)
	const after = JSON.stringify(settings)
	if (after !== shadowAfter) {
		throw new McpSettingsMutatorPurityError(
			"MCP settings mutator must be deterministic and free of side effects; repeated calls produced different settings.",
		)
	}
	if (JSON.stringify(result) !== JSON.stringify(shadowResult)) {
		throw new McpSettingsMutatorPurityError(
			"MCP settings mutator must be deterministic and free of side effects; repeated calls produced different return values.",
		)
	}
	return result
}

/**
 * Locked MCP settings read-update-write. The mutator is synchronous and may be
 * called more than once to validate purity/determinism. Do not perform slow work
 * or side effects inside it; compute values before calling and close over them.
 */
export async function updateMcpSettingsFile<T>(
	settingsPath: string,
	mutator: McpSettingsMutator<T>,
	options: McpSettingsUpdateOptions = {},
): Promise<T> {
	const lockDir = settingsLockDir(settingsPath)
	const token = makeLockToken()
	let lock: AcquiredSettingsLock | undefined
	while (!(lock = await tryAcquireSettingsLock(lockDir, token))) {
		checkAbort(options.abortSignal, lockDir)
		await reclaimStaleLock(lockDir)
		await delay(SETTINGS_LOCK_POLL_MS)
	}
	try {
		checkAbort(options.abortSignal, lockDir)
		const settings = await readSettingsObject(settingsPath)
		const result = runPureSettingsMutator(settings, mutator)
		await atomicWriteSettingsFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
		return result
	} finally {
		await releaseSettingsLock(lock)
	}
}