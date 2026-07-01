const MAX_TERMINAL_OUTPUT_LINE_CHARS = 4096
const MAX_TERMINAL_OUTPUT_CHARS = 65_536

function truncateMiddle(text: string, maxChars: number, reason: string): string {
	if (text.length <= maxChars) {
		return text
	}

	const markerFor = (omitted: number) => `\n... (${reason}, ${omitted} chars omitted) ...\n`
	const maxMarker = markerFor(text.length)

	if (maxMarker.length >= maxChars) {
		return text.slice(0, maxChars)
	}

	const remainingChars = maxChars - maxMarker.length
	const headChars = Math.ceil(remainingChars / 2)
	const tailChars = Math.floor(remainingChars / 2)
	const omitted = text.length - headChars - tailChars
	const marker = markerFor(omitted)

	return `${text.slice(0, headChars)}${marker}${tailChars > 0 ? text.slice(-tailChars) : ""}`
}

function normalizeTerminalOutputLines(outputLines: string[]): string[] {
	return outputLines.flatMap((line) => line.split(/\r\n|\n|\r/))
}

export function formatTerminalOutput(outputLines: string[], lineLimit: number): string {
	const normalizedLineLimit = Math.max(1, Math.floor(lineLimit))
	const normalizedLines = normalizeTerminalOutputLines(outputLines).map((line) =>
		truncateMiddle(line, MAX_TERMINAL_OUTPUT_LINE_CHARS, "line truncated"),
	)

	let result: string
	if (normalizedLines.length > normalizedLineLimit) {
		const startLimit = Math.ceil(normalizedLineLimit / 2)
		const endLimit = Math.floor(normalizedLineLimit / 2)
		const start = normalizedLines.slice(0, startLimit)
		const end = endLimit > 0 ? normalizedLines.slice(normalizedLines.length - endLimit) : []
		result = `${start.join("\n")}\n... (output truncated) ...\n${end.join("\n")}`
	} else {
		result = normalizedLines.join("\n")
	}

	return truncateMiddle(result.trim(), MAX_TERMINAL_OUTPUT_CHARS, "command output truncated")
}
