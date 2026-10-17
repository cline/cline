const HEADER_SEPARATOR = "\r\n\r\n";
const CONTENT_LENGTH_PATTERN = /(?:^|\r\n)Content-Length:\s*(\d+)(?:\r\n|$)/i;

/**
 * Splits a stdio byte stream into Content-Length framed MCP messages.
 *
 * Content-Length counts bytes, so the parser buffers raw bytes and only
 * decodes a body once all of its bytes have arrived. A complete body is a
 * whole UTF-8 sequence, so chunks that end mid-character never reach the
 * decoder; their trailing bytes stay buffered until the next chunk.
 */
export class FramedMessageParser {
	private buffer = Buffer.alloc(0);

	/** Bytes received but not yet emitted as part of a complete message. */
	get bufferedByteLength(): number {
		return this.buffer.length;
	}

	push(chunk: Buffer): string[] {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		const messages: string[] = [];
		while (true) {
			const separatorIndex = this.buffer.indexOf(HEADER_SEPARATOR);
			if (separatorIndex < 0) {
				break;
			}
			const headerText = this.buffer
				.subarray(0, separatorIndex)
				.toString("latin1");
			const contentLengthMatch = headerText.match(CONTENT_LENGTH_PATTERN);
			if (!contentLengthMatch) {
				throw new Error(
					"Invalid MCP stdio frame: missing Content-Length header.",
				);
			}
			const contentLength = Number.parseInt(contentLengthMatch[1], 10);
			const bodyStart = separatorIndex + HEADER_SEPARATOR.length;
			const bodyEnd = bodyStart + contentLength;
			if (this.buffer.length < bodyEnd) {
				break;
			}
			messages.push(this.buffer.subarray(bodyStart, bodyEnd).toString("utf8"));
			this.buffer = this.buffer.subarray(bodyEnd);
		}
		return messages;
	}
}
