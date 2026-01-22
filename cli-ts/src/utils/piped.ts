/**
 * Read piped input from stdin (non-blocking)
 */
export async function readStdinIfPiped(): Promise<string | null> {
	// Check if stdin is a TTY (interactive) or piped
	if (process.stdin.isTTY) {
		return null
	}

	return new Promise((resolve) => {
		let data = ""
		process.stdin.setEncoding("utf8")

		// Set a short timeout in case stdin is not actually providing data
		const timeout = setTimeout(() => {
			process.stdin.removeAllListeners()
			resolve(data.trim() || null)
		}, 100)

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
