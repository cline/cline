import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "mocha"
import "should"

import { cleanupLogsOlderThan } from "../retention"

async function createTempDir(): Promise<string> {
	return await fs.mkdtemp(path.join(os.tmpdir(), "cline-logs-retention-"))
}

async function touchWithMtime(filePath: string, mtime: Date): Promise<void> {
	await fs.writeFile(filePath, "test")
	await fs.utimes(filePath, mtime, mtime)
}

describe("logging retention", () => {
	it("deletes files older than the retention window", async () => {
		const dir = await createTempDir()
		const oldFile = path.join(dir, "old.log")
		const newFile = path.join(dir, "new.log")

		const now = Date.now()
		await touchWithMtime(oldFile, new Date(now - 10_000))
		await touchWithMtime(newFile, new Date(now - 500))

		await cleanupLogsOlderThan({ logsDir: dir, retentionMs: 1_000 })

		await fs.access(newFile)
		await fs
			.access(oldFile)
			.then(() => {
				throw new Error("expected old file to be deleted")
			})
			.catch(() => undefined)
	})

	it("does not delete the active log file", async () => {
		const dir = await createTempDir()
		const recentlyWrittenFile = path.join(dir, "recent.log")
		const oldFile = path.join(dir, "old.log")

		const now = Date.now()
		await touchWithMtime(recentlyWrittenFile, new Date(now - 500))
		await touchWithMtime(oldFile, new Date(now - 10_000))

		await cleanupLogsOlderThan({ logsDir: dir, retentionMs: 1_000 })

		await fs.access(recentlyWrittenFile)
		await fs
			.access(oldFile)
			.then(() => {
				throw new Error("expected other old file to be deleted")
			})
			.catch(() => undefined)
	})

	it("no-ops when the logs directory does not exist", async () => {
		const dir = path.join(os.tmpdir(), `cline-logs-retention-missing-${Date.now()}`)
		await cleanupLogsOlderThan({ logsDir: dir, retentionMs: 1_000 })
	})
})
