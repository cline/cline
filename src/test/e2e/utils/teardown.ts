import fs from "node:fs/promises"
import path from "node:path"
import type { FullConfig } from "playwright/test"
import { getResultsDir, rmForRetries } from "./helpers"

export default async function (_: FullConfig) {
	const assetsDir = getResultsDir()

	try {
		const results = await fs.readdir(assetsDir, { withFileTypes: true })
		await Promise.all(
			results
				.filter((entry) => entry.isDirectory())
				.map(async (entry) => {
					const dirPath = path.join(assetsDir, entry.name)
					const recordingsPath = getResultsDir(entry.name, "recordings")
					const recordings = await fs.readdir(recordingsPath)
					// If there is only one recording, it means the test passed as no retries were needed.
					if (recordings.length === 1) {
						await rmForRetries(dirPath, { recursive: true, force: true })
					}
				}),
		)
	} catch (error) {
		// Silently handle case where assets directory doesn't exist
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
	}
}
