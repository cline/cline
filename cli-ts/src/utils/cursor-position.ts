/**
 * Query terminal cursor position before Ink mounts
 * Must be called BEFORE render() to avoid escape sequence leaking into Ink's input handling
 */

export async function queryCursorPos(
	stdin: NodeJS.ReadStream,
	stdout: NodeJS.WriteStream,
	{ timeoutMs = 75 } = {},
): Promise<{ row: number; col: number } | null> {
	if (!stdin.isTTY || !stdout.isTTY || typeof (stdin as any).setRawMode !== "function") return null

	const ttyIn = stdin as any as { isRaw?: boolean; setRawMode: (b: boolean) => void; on: any; off: any }
	const wasRaw = !!ttyIn.isRaw

	ttyIn.setRawMode(true)
	stdin.resume()

	return await new Promise((resolve) => {
		let buf = ""
		const onData = (chunk: Buffer) => {
			buf += chunk.toString("utf8")
			const m = buf.match(/\x1b\[(\d+);(\d+)R/)
			if (!m) return
			cleanup()
			resolve({ row: Number(m[1]), col: Number(m[2]) })
		}

		const cleanup = () => {
			clearTimeout(timer)
			stdin.off("data", onData)
			try {
				ttyIn.setRawMode(wasRaw)
			} catch {}
		}

		const timer = setTimeout(() => {
			cleanup()
			resolve(null)
		}, timeoutMs)

		stdin.on("data", onData)
		stdout.write("\x1b[6n") // DSR: cursor position
	})
}

/**
 * Calculate where the robot will be rendered on screen
 */
export function calculateRobotTopRow(cursorPos: { row: number } | null, terminalRows: number): number {
	const robotHeight = 12
	const firstFrameHeight = robotHeight + 8 // robot + welcome text + margins + input + footer

	const startRow = cursorPos?.row ?? 1
	// If content doesn't fit below cursor, terminal scrolls
	return Math.max(1, Math.min(startRow, terminalRows - firstFrameHeight + 1))
}
