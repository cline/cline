import { promises as fs, type Stats } from "fs"
import * as path from "path"

export const LOG_RETENTION_DAYS = 30
export const LOG_RETENTION_MS = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

export interface CleanupLogsOlderThanOptions {
	logsDir: string
	retentionMs?: number
}

/**
 * Opportunistically removes old log files.
 *
 * Deletes regular files in `logsDir` whose `mtime` is older than `retentionMs`.
 * `mtime` is treated as "last active" (appends update it), which is safe across multiple VS Code windows.
 *
 * This function is non-fatal: it swallows filesystem errors (e.g. locked files on Windows,
 * concurrent writers, files disappearing between stat/unlink) so logging/startup is never impacted.
 */
export async function cleanupLogsOlderThan(options: CleanupLogsOlderThanOptions): Promise<void> {
	const { logsDir, retentionMs = LOG_RETENTION_MS } = options

	// If the logs directory doesn't exist, nothing to do.
	try {
		await fs.access(logsDir)
	} catch {
		return
	}

	let entries: string[]
	try {
		entries = await fs.readdir(logsDir)
	} catch {
		return
	}

	const cutoffMs = Date.now() - retentionMs

	await Promise.all(
		entries.map(async (entry) => {
			const filePath = path.join(logsDir, entry)

			let stat: Stats
			try {
				stat = await fs.stat(filePath)
			} catch {
				return
			}

			if (!stat.isFile()) {
				return
			}

			if (stat.mtimeMs < cutoffMs) {
				try {
					await fs.unlink(filePath)
				} catch {
					return
				}
			}
		}),
	)
}
