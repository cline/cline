import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface LearningPackStoragePaths {
	readonly root: string
	readonly registry: string
	readonly trust: string
	readonly packs: string
	readonly transactions: string
	readonly locks: string
}

export function learningPackStoragePaths(root: string): LearningPackStoragePaths {
	const resolved = path.resolve(root)
	return Object.freeze({
		root: resolved,
		registry: path.join(resolved, "registry.json"),
		trust: path.join(resolved, "trusted-publishers.json"),
		packs: path.join(resolved, "packs"),
		transactions: path.join(resolved, "transactions"),
		locks: path.join(resolved, "locks"),
	})
}

export async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8")) as T
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback
		throw error
	}
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}`
	try {
		const handle = await fs.open(temporary, "wx", 0o600)
		try {
			await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8")
			await handle.sync()
		} finally {
			await handle.close()
		}
		await fs.rename(temporary, filePath)
	} finally {
		await fs.rm(temporary, { force: true })
	}
}

export interface PackLock {
	readonly packId: string
	readonly release: () => Promise<void>
}

export function packLockPath(root: string, packId: string): string {
	return path.join(learningPackStoragePaths(root).locks, `${encodeURIComponent(packId)}.lock`)
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

export async function acquirePackLock(root: string, packId: string, now = Date.now()): Promise<PackLock | null> {
	const paths = learningPackStoragePaths(root)
	const lockPath = packLockPath(root, packId)
	await fs.mkdir(paths.locks, { recursive: true })
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			await fs.mkdir(lockPath)
			await fs.writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, createdAt: now })}\n`, {
				encoding: "utf8",
				flag: "wx",
				mode: 0o600,
			})
			let released = false
			return Object.freeze({
				packId,
				release: async () => {
					if (released) return
					released = true
					await fs.rm(lockPath, { recursive: true, force: true })
				},
			})
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
			const owner = await readJsonFile<{ pid?: number; createdAt?: number }>(path.join(lockPath, "owner.json"), {})
			const staleByPid = typeof owner.pid === "number" && !processIsAlive(owner.pid)
			const lockStat = await fs.stat(lockPath)
			const abandonedBeforeOwnerWrite = owner.pid === undefined && now - lockStat.mtimeMs > 60_000
			if (attempt === 0 && (staleByPid || abandonedBeforeOwnerWrite)) {
				await fs.rm(lockPath, { recursive: true, force: true })
				continue
			}
			return null
		}
	}
	return null
}
