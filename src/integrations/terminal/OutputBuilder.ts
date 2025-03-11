import { TERMINAL_OUTPUT_LIMIT } from "../../shared/terminal"

interface OutputBuilderOptions {
	maxSize?: number // Max size of the buffer.
	preserveStartPercent?: number // % of `maxSize` to preserve at start.
	preserveEndPercent?: number // % of `maxSize` to preserve at end
	truncationMessage?: string
}

/**
 * OutputBuilder manages terminal output with intelligent middle truncation.
 *
 * When output exceeds a specified size limit, this class truncates content
 * primarily from the middle, preserving both the beginning (command context)
 * and the end (recent output) of the buffer for better diagnostic context.
 */
export class OutputBuilder {
	public readonly preserveStartSize: number
	public readonly preserveEndSize: number
	public readonly truncationMessage: string

	private startBuffer = ""
	private endBuffer = ""
	private _bytesProcessed = 0
	private _bytesRemoved = 0
	private _cursor = 0

	constructor({
		maxSize = TERMINAL_OUTPUT_LIMIT, // 100KB
		preserveStartPercent = 50, // 50% of `maxSize`
		preserveEndPercent = 50, // 50% of `maxSize`
		truncationMessage = "\n[... OUTPUT TRUNCATED ...]\n",
	}: OutputBuilderOptions = {}) {
		this.preserveStartSize = Math.floor((preserveStartPercent / 100) * maxSize)
		this.preserveEndSize = Math.floor((preserveEndPercent / 100) * maxSize)

		if (this.preserveStartSize + this.preserveEndSize > maxSize) {
			throw new Error("Invalid configuration: preserve sizes exceed maxSize")
		}

		this.truncationMessage = truncationMessage
	}

	append(content: string): this {
		if (content.length === 0) {
			return this
		}

		this._bytesProcessed += content.length

		if (!this.isTruncated) {
			this.startBuffer += content

			const excessBytes = this.startBuffer.length - (this.preserveStartSize + this.preserveEndSize)

			if (excessBytes <= 0) {
				return this
			}

			this.endBuffer = this.startBuffer.slice(-this.preserveEndSize)
			this.startBuffer = this.startBuffer.slice(0, this.preserveStartSize)
			this._bytesRemoved += excessBytes
		} else {
			// Already in truncation mode; append to `endBuffer`.
			this.endBuffer += content

			// If `endBuffer` gets too large, trim it.
			if (this.endBuffer.length > this.preserveEndSize) {
				const excessBytes = this.endBuffer.length - this.preserveEndSize
				this.endBuffer = this.endBuffer.slice(excessBytes)
				this._bytesRemoved += excessBytes
			}
		}

		return this
	}

	/**
	 * Reads unprocessed content from the current cursor position, handling both
	 * truncated and non-truncated states.
	 *
	 * The algorithm handles three cases:
	 * 1. Non-truncated buffer:
	 *    - Simply returns remaining content from cursor position.
	 *
	 * 2. Truncated buffer, cursor in start portion:
	 *    - Returns remaining start content plus all end content.
	 *    - This ensures we don't miss the transition between buffers.
	 *
	 * 3. Truncated buffer, cursor in end portion:
	 *    - Adjusts cursor position by subtracting removed bytes and start buffer length.
	 *    - Uses Math.max to prevent negative indices if cursor adjustment overshoots.
	 *    - Returns remaining content from adjusted position in end buffer.
	 *
	 * This approach ensures continuous reading even across truncation
	 * boundaries, while properly tracking position in both start and end
	 * portions of truncated content.
	 */
	read() {
		let output

		if (!this.isTruncated) {
			output = this.startBuffer.slice(this.cursor)
		} else if (this.cursor < this.startBuffer.length) {
			output = this.startBuffer.slice(this.cursor) + this.endBuffer
		} else {
			output = this.endBuffer.slice(Math.max(this.cursor - this.bytesRemoved - this.startBuffer.length, 0))
		}

		this._cursor = this.bytesProcessed
		return output
	}

	/**
	 * Same as above, but read only line at a time.
	 */
	readLine() {
		let output
		let index = -1

		if (!this.isTruncated) {
			output = this.startBuffer.slice(this.cursor)
			index = output.indexOf("\n")
		} else if (this.cursor < this.startBuffer.length) {
			output = this.startBuffer.slice(this.cursor)
			index = output.indexOf("\n")

			if (index === -1) {
				output = output + this.endBuffer
				index = output.indexOf("\n")
			}
		} else {
			output = this.endBuffer.slice(Math.max(this.cursor - this.bytesRemoved - this.startBuffer.length, 0))
			index = output.indexOf("\n")
		}

		if (index >= 0) {
			this._cursor = this.bytesProcessed - (output.length - index) + 1
			return output.slice(0, index + 1)
		}

		this._cursor = this.bytesProcessed
		return output
	}

	public reset(content?: string) {
		this.startBuffer = ""
		this.endBuffer = ""
		this._bytesProcessed = 0
		this._bytesRemoved = 0
		this._cursor = 0

		if (content) {
			this.append(content)
		}
	}

	public get content() {
		return this.isTruncated ? this.startBuffer + this.truncationMessage + this.endBuffer : this.startBuffer
	}

	public get size() {
		return this.isTruncated
			? this.startBuffer.length + this.truncationMessage.length + this.endBuffer.length
			: this.startBuffer.length
	}

	public get isTruncated() {
		return this._bytesRemoved > 0
	}

	public get bytesProcessed() {
		return this._bytesProcessed
	}

	public get bytesRemoved() {
		return this._bytesRemoved
	}

	public get cursor() {
		return this._cursor
	}
}
