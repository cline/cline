/**
 * Read piped input from stdin (non-blocking)
 *
 * This function is designed to work with piped input, including chained commands:
 *   git diff | cline 'explain' | cline 'summarize'
 *
 * The challenge is that when chaining cline commands, the first command may take
 * several seconds to complete, so we can't use a short timeout. Instead, we wait
 * for EOF which signals that the previous command has finished writing.
 */
export async function readStdinIfPiped(): Promise<string | null> {
	// Check if stdin is a TTY (interactive) or piped
	if (process.stdin.isTTY) {
		return null
	}

	// Use async approach - more reliable for piped input from other commands
	// The synchronous readFileSync(0) can fail with EAGAIN when the pipe
	// isn't ready yet (common when piping from another cline command)
	return new Promise((resolve) => {
		let data = ""
		process.stdin.setEncoding("utf8")

		// For piped input, we wait for EOF (end event) which signals the
		// previous command in the pipe has finished writing. We use a longer
		// timeout as a safety net for cases where stdin is opened but never
		// written to (e.g., some edge cases with file descriptors).
		// 5 minutes should be more than enough for any reasonable pipeline.
		const timeout = setTimeout(
			() => {
				process.stdin.removeAllListeners()
				resolve(data.trim() || null)
			},
			5 * 60 * 1000,
		) // 5 minutes

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
