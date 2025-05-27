import { JSONParser } from "@streamparser/json"
// Assuming ParsedElementInfo might be a type available on JSONParser or a sub-module
// This is speculative without seeing the library's d.ts file.
// If the library is installed, `import { JSONParser, ParsedElementInfo } from '@streamparser/json';` should work.
// For now, let's try to define it based on the error message if the direct import fails due to missing module.

// Fallback type definition based on the error message: "Property 'value' is optional in type 'ParsedElementInfo'"
// This is a temporary measure if the module isn't found by TS.
type ParsedElementInfo = {
	value?: any // Value is optional
	key?: string | number
	parent?: any
	stack?: any[] // Stack of parent objects/arrays
	// Add other properties if known from library docs or d.ts
}

export interface ReplacementItem {
	old_str: string
	new_str: string
}

export class StreamingJsonReplacer {
	private currentFileContent: string
	private parser: JSONParser
	private onContentUpdated: (newContent: string, isFinalItem: boolean) => void
	private onErrorCallback: (error: Error) => void
	private itemsProcessed: number = 0
	private successfullyParsedItems: ReplacementItem[] = []
	private buffer: string = ""
	private isComplete: boolean = false
	private errorCount: number = 0
	private maxErrorRetries: number = 3
	private flushTimer: NodeJS.Timeout | null = null
	private flushInterval: number = 200 // 200ms flush interval

	constructor(
		initialContent: string,
		onContentUpdatedCallback: (newContent: string, isFinalItem: boolean) => void,
		onErrorCallback: (error: Error) => void,
	) {
		this.currentFileContent = initialContent
		this.onContentUpdated = onContentUpdatedCallback
		this.onErrorCallback = onErrorCallback

		this.parser = new JSONParser({ paths: ["$.replacements.*"] })

		this.parser.onValue = (parsedElementInfo: ParsedElementInfo) => {
			const { value } = parsedElementInfo // Destructure to get value, which might be undefined
			// This callback is triggered for each item matched by '$.replacements.*'
			if (value && typeof value === "object" && "old_str" in value && "new_str" in value) {
				const item = value as ReplacementItem // Value here is confirmed to be an object

				if (typeof item.old_str === "string" && typeof item.new_str === "string") {
					this.successfullyParsedItems.push(item) // Store the structurally valid item

					if (this.currentFileContent.includes(item.old_str)) {
						this.currentFileContent = this.currentFileContent.replace(item.old_str, item.new_str)
						this.itemsProcessed++
						// Notify that an item has been processed. The `isFinalItem` argument here is tricky
						// as we don't know from the parser alone if this is the *absolute* last item
						// until the stream ends. The caller (Task.ts) will manage the final update.
						// For now, we'll pass `false` and let Task.ts handle the final diff view update.
						this.onContentUpdated(this.currentFileContent, false)
					} else {
						const snippet = item.old_str.length > 50 ? item.old_str.substring(0, 47) + "..." : item.old_str
						const error = new Error(`Streaming Replacement failed: 'old_str' not found. Snippet: "${snippet}"`)
						this.onErrorCallback(error) // Call our own error callback
					}
				} else {
					const error = new Error(`Invalid item structure in replacements stream: ${JSON.stringify(item)}`)
					this.onErrorCallback(error) // Call our own error callback
				}
			} else if (value && (Array.isArray(value) || (typeof value === "object" && "replacements" in value))) {
				// This might be the 'replacements' array itself or the root object.
				// The `paths: ['$.replacements.*']` should mean we only get items.
				// If we get here, it's likely the root object if paths wasn't specific enough or if it's an empty replacements array.
				// console.log("Streaming parser emitted container:", value);
			} else {
				// Value is not a ReplacementItem or a known container, could be an issue with the JSON structure or path.
				// If `paths` is correct, this path should ideally not be hit often for valid streams.
				// console.warn("Streaming parser emitted unexpected value:", value);
			}
		}

		this.parser.onError = (err: Error) => {
			// Propagate the error to the caller via the callback
			this.onErrorCallback(err)
			// Note: The @streamparser/json library might throw synchronously on write if onError is not set,
			// or if it re-throws. We'll ensure Task.ts wraps write/end in try-catch.
		}

		this.parser.onEnd = () => {
			// Stream ended. The final content is in this.currentFileContent.
			// The caller (Task.ts) will call getCurrentContent() after parser.end()
			// and then call onContentUpdated with isFinalItem = true.
			// console.log("JSON stream ended. Items processed:", this.itemsProcessed);
		}
	}

	private scheduleFlush(): void {
		// Clear any existing timer
		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
		}

		// Schedule a new flush
		this.flushTimer = setTimeout(() => {
			this.flushBuffer()
		}, this.flushInterval)
	}

	private flushBuffer(): void {
		if (this.buffer.length === 0 || this.isComplete) {
			return
		}

		// Try to parse whatever is in the buffer
		try {
			this.parser.write(this.buffer)
			this.buffer = ""
			this.errorCount = 0
		} catch (error) {
			// If parsing fails, keep the buffer and wait for more data
			console.log("Buffer flush failed, waiting for more data:", error)
		}
	}

	public write(jsonChunk: string): void {
		// If we've already completed parsing, ignore additional chunks
		if (this.isComplete) {
			return
		}

		// Add chunk to buffer
		this.buffer += jsonChunk

		// Schedule a flush
		this.scheduleFlush()

		// Try to parse the buffered content
		try {
			// First, check if we have a complete JSON structure
			// Look for balanced braces
			let braceCount = 0
			let inString = false
			let escapeNext = false

			for (let i = 0; i < this.buffer.length; i++) {
				const char = this.buffer[i]

				if (escapeNext) {
					escapeNext = false
					continue
				}

				if (char === "\\") {
					escapeNext = true
					continue
				}

				if (char === '"' && !escapeNext) {
					inString = !inString
					continue
				}

				if (!inString) {
					if (char === "{") braceCount++
					else if (char === "}") braceCount--

					// If we've closed all braces, we might have complete JSON
					if (braceCount === 0 && i > 0) {
						// Extract the complete JSON
						const completeJson = this.buffer.substring(0, i + 1)
						const remainingBuffer = this.buffer.substring(i + 1)

						// Try to parse this chunk
						try {
							this.parser.write(completeJson)
							// If successful, clear the processed part from buffer
							this.buffer = remainingBuffer.trim()
							this.errorCount = 0 // Reset error count on success

							// Clear the flush timer since we successfully parsed
							if (this.flushTimer) {
								clearTimeout(this.flushTimer)
								this.flushTimer = null
							}

							// If there's no more content, mark as complete
							if (this.buffer.length === 0 || this.buffer.match(/^\s*$/)) {
								this.isComplete = true
							}
							return
						} catch (parseError) {
							// If parsing failed, continue looking for complete JSON
							continue
						}
					}
				}
			}

			// If we haven't found complete JSON yet, just accumulate in buffer
			// The parser will process it when we have complete JSON
		} catch (error) {
			this.errorCount++

			// If we've had too many errors, try to parse what we have
			if (this.errorCount >= this.maxErrorRetries) {
				try {
					this.parser.write(this.buffer)
					this.buffer = ""
					this.isComplete = true
				} catch (finalError) {
					// If even this fails, report the error
					this.onErrorCallback(new Error(`Failed to parse JSON after ${this.maxErrorRetries} attempts: ${finalError}`))
				}
			}
		}
	}

	public end(): void {
		// Clear any pending flush timer
		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
			this.flushTimer = null
		}

		// If there's any remaining content in the buffer, try to parse it
		if (this.buffer.length > 0 && !this.isComplete) {
			try {
				// Attempt to parse any remaining buffered content
				this.parser.write(this.buffer)
				this.buffer = ""
			} catch (error) {
				// If parsing the buffer fails, log it but continue
				console.warn("Failed to parse remaining buffer content:", error)
			}
		}

		// Mark as complete
		this.isComplete = true

		// Errors during end will be caught by the parser's onError or thrown.
		this.parser.end()
	}

	public getCurrentContent(): string {
		return this.currentFileContent
	}

	public getItemsProcessedCount(): number {
		return this.itemsProcessed
	}

	public getSuccessfullyParsedItems(): ReplacementItem[] {
		return [...this.successfullyParsedItems] // Return a copy
	}
}
