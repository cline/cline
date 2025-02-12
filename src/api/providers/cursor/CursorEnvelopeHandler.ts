import { Logger } from "../../../services/logging/Logger"

export class CursorEnvelopeError extends Error {
	constructor(
		message: string,
		public readonly type: "validation" | "protocol" | "size" | "unknown" = "unknown",
		public readonly details?: unknown,
	) {
		super(message)
		this.name = "CursorEnvelopeError"
		Object.setPrototypeOf(this, CursorEnvelopeError.prototype)
	}
}

export const enum EnvelopeFlag {
	NORMAL = 0x00,
	END_STREAM = 0x02,
	ERROR = 0x04,
}

export class CursorEnvelopeHandler {
	private readonly MAX_MESSAGE_SIZE = 4294967296 // 4GB (2^32 bytes) per spec

	constructor() {}

	private log(message: string) {
		const timestamp = new Date().toISOString()
		Logger.log(`[CURSOR ENVELOPE ${timestamp}] ${message}`)
	}

	/**
	 * Validates an envelope buffer and checks if it contains a complete message
	 * @throws {CursorEnvelopeError} If validation fails
	 */
	public validateEnvelope(buffer: Uint8Array): { isComplete: boolean; totalLength: number; messageLength: number } {
		try {
			if (buffer.length < 5) {
				return { isComplete: false, totalLength: 0, messageLength: 0 }
			}

			const flag = buffer[0]
			// Read length as unsigned 32-bit integer in big-endian format
			const messageLength = new DataView(buffer.buffer, buffer.byteOffset + 1, 4).getUint32(0, false)
			const totalLength = messageLength + 5

			// Log the actual size details for debugging
			this.log(`📏 Envelope details:`)
			this.log(`   Flag: 0x${flag.toString(16)}`)
			this.log(`   Message length: ${messageLength} bytes`)
			this.log(`   Total length with header: ${totalLength} bytes`)
			this.log(`   Current buffer size: ${buffer.length} bytes`)
			this.log(
				`   Raw header: ${Array.from(buffer.slice(0, 5))
					.map((b) => b.toString(16).padStart(2, "0"))
					.join(" ")}`,
			)
			this.log(
				`   Raw data: ${Array.from(buffer)
					.map((b) => b.toString(16).padStart(2, "0"))
					.join(" ")}`,
			)

			// Validate length before checking completeness
			if (messageLength > this.MAX_MESSAGE_SIZE) {
				throw new CursorEnvelopeError(
					`Message size ${messageLength} exceeds maximum allowed size ${this.MAX_MESSAGE_SIZE}`,
					"size",
					{ messageLength, maxSize: this.MAX_MESSAGE_SIZE },
				)
			}

			// Check if we have enough data for the complete message
			return {
				isComplete: buffer.length >= totalLength,
				totalLength,
				messageLength,
			}
		} catch (error) {
			if (error instanceof CursorEnvelopeError) {
				throw error
			}
			throw new CursorEnvelopeError(
				"Failed to validate envelope",
				"validation",
				error instanceof Error ? error.message : error,
			)
		}
	}

	/**
	 * Decodes an envelope buffer into flag and data
	 * @throws {CursorEnvelopeError} If decoding fails
	 */
	public decodeEnvelope(buffer: Uint8Array): { flag: number; data: Uint8Array } {
		try {
			if (buffer.length < 5) {
				throw new CursorEnvelopeError("Invalid data length: too short", "validation", { length: buffer.length })
			}

			const flag = buffer[0]
			const messageLength = new DataView(buffer.buffer, buffer.byteOffset + 1, 4).getUint32(0, false)
			const totalLength = messageLength + 5

			// Validate exact length like Rust implementation
			if (buffer.length !== totalLength) {
				throw new CursorEnvelopeError(
					`Protocol error: promised ${messageLength} bytes in enveloped message, got ${buffer.length - 5} bytes`,
					"protocol",
					{ promised: messageLength, actual: buffer.length - 5 },
				)
			}

			// Validate length before returning data
			if (messageLength > this.MAX_MESSAGE_SIZE) {
				throw new CursorEnvelopeError(
					`Message size ${messageLength} exceeds maximum allowed size ${this.MAX_MESSAGE_SIZE}`,
					"size",
					{ messageLength, maxSize: this.MAX_MESSAGE_SIZE },
				)
			}

			return {
				flag,
				data: buffer.slice(5, totalLength), // Ensure we only take the message length
			}
		} catch (error) {
			if (error instanceof CursorEnvelopeError) {
				throw error
			}
			throw new CursorEnvelopeError(
				"Failed to decode envelope",
				"validation",
				error instanceof Error ? error.message : error,
			)
		}
	}

	/**
	 * Encodes data into an envelope buffer
	 * @throws {CursorEnvelopeError} If encoding fails
	 */
	public encodeEnvelope(data: Uint8Array | string | object, flag: number = EnvelopeFlag.NORMAL): Uint8Array {
		try {
			let dataBytes: Uint8Array
			if (typeof data === "string") {
				dataBytes = new TextEncoder().encode(data)
			} else if (data instanceof Uint8Array) {
				dataBytes = data
			} else {
				// For objects, we want to match Rust's serde_json behavior exactly
				const jsonString = JSON.stringify(data)
				dataBytes = new TextEncoder().encode(jsonString)
			}

			// Validate length before creating envelope
			if (dataBytes.length > this.MAX_MESSAGE_SIZE) {
				throw new CursorEnvelopeError(
					`Message size ${dataBytes.length} exceeds maximum allowed size ${this.MAX_MESSAGE_SIZE}`,
					"size",
					{ messageLength: dataBytes.length, maxSize: this.MAX_MESSAGE_SIZE },
				)
			}

			const result = new Uint8Array(5 + dataBytes.length)
			result[0] = flag
			new DataView(result.buffer).setUint32(1, dataBytes.length, false) // false = big-endian
			result.set(dataBytes, 5)
			return result
		} catch (error) {
			if (error instanceof CursorEnvelopeError) {
				throw error
			}
			throw new CursorEnvelopeError(
				"Failed to encode envelope",
				"validation",
				error instanceof Error ? error.message : error,
			)
		}
	}

	/**
	 * Parses an error message from envelope data
	 */
	public parseErrorMessage(data: Uint8Array): string {
		try {
			const errorText = new TextDecoder().decode(data)
			this.log(`🔍 Raw error text: ${errorText}`)
			const errorJson = JSON.parse(errorText)
			// Match Rust's error handling order exactly
			if (errorJson.error?.message) {
				return errorJson.error.message
			} else if (errorJson.error?.code && errorJson.error?.message) {
				return `${errorJson.error.code}: ${errorJson.error.message}`
			}
			return errorText
		} catch (error) {
			this.log(`⚠️ Failed to parse error JSON: ${error}`)
			return new TextDecoder().decode(data)
		}
	}
}
