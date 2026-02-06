import * as fs from "node:fs"

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
	// Check if stdin is a TTY (interactive) - no piped input
	if (process.stdin.isTTY) {
		return null
	}

	// When spawned as a child process without TTY (e.g., from spawn()), stdin.isTTY
	// is false but there's no actual piped input. Check if stdin is a real pipe/file
	// by testing if we can get stats on fd 0. A real pipe will have stats, while
	// a detached stdin may throw or have unusual properties.
	try {
		const stats = fs.fstatSync(0)
		// If it's not a FIFO (pipe) or regular file, treat as no input
		if (!stats.isFIFO() && !stats.isFile()) {
			return null
		}
	} catch {
		// If we can't stat stdin, treat as no input
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
			// Return empty string (not null) when stdin was piped but empty
			// This allows callers to distinguish between "no piped input" (null)
			// and "empty piped input" ("") for proper error handling
			resolve(data.trim())
		})

		process.stdin.on("error", () => {
			clearTimeout(timeout)
			resolve(null)
		})

		// Resume stdin in case it's paused
		process.stdin.resume()
	})
}
