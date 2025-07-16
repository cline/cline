import { rmSync } from "node:fs"
import { getResultsDir } from "./helpers"

export default async function (): Promise<void> {
	const path = getResultsDir()
	const options = { recursive: true, force: true }

	const maxAttempts = 2

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			rmSync(path, options)
			return
		} catch (error) {
			if (attempt === maxAttempts) {
				throw new Error(`Failed to rmSync ${path} after ${maxAttempts} attempts: ${error}`)
			}
			console.error(`Failed to rmSync ${path} after ${attempt} attempts: ${error}`)
			await new Promise((resolve) => setTimeout(resolve, 50 * attempt)) // Progressive delay
		}
	}
}
