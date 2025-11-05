import { Buffer } from "buffer"

export const DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT = 256 * 1024

export interface AppendWithLimitOptions {
	existing: string
	addition: string
	byteLimit: number
}

export interface AppendWithLimitResult {
	nextBuffer: string
	appendedText: string
	truncated: boolean
	omittedBytes: number
}

/**
 * Appends text to a terminal buffer while enforcing a maximum byte limit.
 * Returns the new buffer content along with metadata about any truncation
 * that occurred during the append operation.
 */
export function appendWithByteLimit({ existing, addition, byteLimit }: AppendWithLimitOptions): AppendWithLimitResult {
	if (addition.length === 0) {
		return {
			nextBuffer: existing,
			appendedText: "",
			truncated: false,
			omittedBytes: 0,
		}
	}

	if (byteLimit <= 0) {
		return {
			nextBuffer: existing,
			appendedText: "",
			truncated: addition.length > 0,
			omittedBytes: byteLength(addition),
		}
	}

	const existingBytes = byteLength(existing)
	const additionBytes = byteLength(addition)

	if (existingBytes >= byteLimit) {
		return {
			nextBuffer: existing,
			appendedText: "",
			truncated: additionBytes > 0,
			omittedBytes: additionBytes,
		}
	}

	const availableBytes = byteLimit - existingBytes

	if (additionBytes <= availableBytes) {
		return {
			nextBuffer: existing + addition,
			appendedText: addition,
			truncated: false,
			omittedBytes: 0,
		}
	}

	let allowedText = ""
	let consumedBytes = 0

	for (const char of addition) {
		const charBytes = byteLength(char)
		if (consumedBytes + charBytes > availableBytes) {
			break
		}
		allowedText += char
		consumedBytes += charBytes
	}

	return {
		nextBuffer: existing + allowedText,
		appendedText: allowedText,
		truncated: true,
		omittedBytes: additionBytes - consumedBytes,
	}
}

export function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8")
}

export function formatByteSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 B"
	}

	const units = ["B", "KB", "MB", "GB", "TB"] as const
	let size = bytes
	let unitIndex = 0

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024
		unitIndex++
	}

	const formatted = size >= 10 || unitIndex === 0 ? Math.round(size).toString() : size.toFixed(1)
	return `${formatted} ${units[unitIndex]}`
}

export function buildTruncationNotice(limitBytes: number, omittedBytes: number): string {
	return ` [output truncated at ${formatByteSize(limitBytes)}; ${formatByteSize(omittedBytes)} omitted]`
}
