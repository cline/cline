import * as fs from "node:fs"

/**
 * Read piped input from stdin (non-blocking)
 */
export async function readStdinIfPiped(): Promise<string | null> {
	// Check if stdin is a TTY (interactive) or piped
	if (process.stdin.isTTY) {
		return null
	}

	try {
		// Use synchronous read for reliability with piped input
		// fd 0 is stdin
		const data = fs.readFileSync(0, "utf8")
		return data.trim() || null
	} catch {
		// Fallback to async approach if sync read fails
		return new Promise((resolve) => {
			let data = ""
			process.stdin.setEncoding("utf8")

			// Set a timeout in case stdin is not actually providing data
			const timeout = setTimeout(() => {
				process.stdin.removeAllListeners()
				resolve(data.trim() || null)
			}, 1000)

			process.stdin.on("data", (chunk) => {
				data += chunk
			})

			process.stdin.on("end", () => {
				clearTimeout(timeout)
				resolve(data.trim() || null)
			})

			process.stdin.on("error", () => {
				clearTimeout(timeout)
				resolve(null)
			})

			// Resume stdin in case it's paused
			process.stdin.resume()
		})
	}
}
