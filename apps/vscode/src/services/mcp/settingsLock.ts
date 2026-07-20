import { randomUUID } from "node:crypto"
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs"
import * as path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
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

export function isSettingsLockContentionError(error: unknown): boolean {
	if (error === null || typeof error !== "object") {
		return false
	}
	const code = (error as NodeJS.ErrnoException).code
	return code === "EEXIST" || code === "ENOTEMPTY"
}

function ensurePrivateSettingsDirectory(directoryPath: string): void {
	mkdirSync(directoryPath, { recursive: true, mode: 0o700 })
	if (process.platform !== "win32") {
		try {
			chmodSync(directoryPath, 0o700)
		} catch (error) {
			warnPermissionRepairFailure(directoryPath, 0o700, error)
		}
	}
}

function warnPermissionRepairFailure(targetPath: string, mode: number, error: unknown): void {
	const fsError = error as NodeJS.ErrnoException
	if (fsError?.code === "ENOENT") {
		return
	}
	const details = fsError?.code ?? (error instanceof Error ? error.message : String(error))
	Logger.warn(`[mcp-settings] Unable to set permissions ${mode.toString(8)} on ${targetPath}: ${details}`)
}

function hardenExistingSettingsFile(settingsPath: string): void {
	if (process.platform === "win32") {
		return
	}
	try {
		chmodSync(settingsPath, 0o600)
	} catch (error) {
		warnPermissionRepairFailure(settingsPath, 0o600, error)
	}
}

function atomicWriteSettingsFile(settingsPath: string, contents: string): void {
	const tempPath = `${settingsPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
	ensurePrivateSettingsDirectory(path.dirname(settingsPath))
	try {
		writeFileSync(tempPath, contents, { encoding: "utf-8", flag: "wx", mode: 0o600 })
		renameSync(tempPath, settingsPath)
		hardenExistingSettingsFile(settingsPath)
	} catch (error) {
		try {
			unlinkSync(tempPath)
		} catch {
			// Best-effort cleanup of the temp file.
		}
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
function tryAcquireSettingsLock(lockDir: string, token: string): AcquiredSettingsLock | undefined {
	ensurePrivateSettingsDirectory(path.dirname(lockDir))
	const stagingDir = `${lockDir}.tmp.${token}`
	rmSync(stagingDir, { recursive: true, force: true })
	mkdirSync(stagingDir, { recursive: true, mode: 0o700 })
	const ownerFileName = `owner.${token}`
	const stagingOwnerFile = path.join(stagingDir, ownerFileName)
	writeFileSync(stagingOwnerFile, token, { encoding: "utf8", flag: "wx" })
	try {
		renameSync(stagingDir, lockDir)
		return { lockDir, ownerFile: path.join(lockDir, ownerFileName) }
	} catch (error) {
		rmSync(stagingDir, { recursive: true, force: true })
		// On POSIX, renaming a directory over another populated directory may
		// report either EEXIST or ENOTEMPTY. The winning writer can release the
		// lock before existsSync runs, so classify the original error first.
		if (isSettingsLockContentionError(error) || existsSync(lockDir)) {
			return undefined
		}
		throw error
	}
}

function reclaimStaleLock(lockDir: string): void {
	let ageMs: number
	try {
		ageMs = Date.now() - statSync(lockDir).mtimeMs
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
		renameSync(lockDir, staleDir)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return
		}
		throw error
	}
	rmSync(staleDir, { recursive: true, force: true })
}

function releaseSettingsLock(lock: AcquiredSettingsLock): void {
	try {
		unlinkSync(lock.ownerFile)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
	}
	try {
		rmdirSync(lock.lockDir)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") {
			throw error
		}
	}
}

function checkAbort(signal: AbortSignal | undefined, lockDir: string): void {
	if (signal?.aborted) {
		throw new McpSettingsLockAbortedError(`Aborted waiting for MCP settings lock at ${lockDir}.`)
	}
}

function readSettingsObject(settingsPath: string): Record<string, unknown> {
	let settings: Record<string, unknown>
	try {
		hardenExistingSettingsFile(settingsPath)
		settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>
	} catch (error) {
		// A missing file bootstraps to an empty object so the first locked write
		// creates it. A present-but-malformed file still throws.
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
		settings = {}
	}
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
 *
 * Waiting for another process to release the lock is async, but once this
 * process owns the lock, the critical section uses synchronous filesystem calls.
 * @cline/core OAuth writes use a synchronous lock in the same extension host;
 * yielding here while holding the lock would let that sync waiter block the
 * event loop before this holder can resume and release it.
 */
export async function updateMcpSettingsFile<T>(
	settingsPath: string,
	mutator: McpSettingsMutator<T>,
	options: McpSettingsUpdateOptions = {},
): Promise<T> {
	const lockDir = settingsLockDir(settingsPath)
	const token = makeLockToken()
	let lock: AcquiredSettingsLock | undefined
	while (!(lock = tryAcquireSettingsLock(lockDir, token))) {
		checkAbort(options.abortSignal, lockDir)
		reclaimStaleLock(lockDir)
		await delay(SETTINGS_LOCK_POLL_MS)
	}
	try {
		checkAbort(options.abortSignal, lockDir)
		const settings = readSettingsObject(settingsPath)
		const result = runPureSettingsMutator(settings, mutator)
		atomicWriteSettingsFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
		return result
	} finally {
		releaseSettingsLock(lock)
	}
}
