import { JSONParser } from "@streamparser/json"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// Fallback type definition based on the error message: "Property 'value' is optional in type 'ParsedElementInfo'"
type ParsedElementInfo = {
	value?: any
	key?: string | number
	parent?: any
	stack?: any[]
}

export interface ReplacementItem {
	old_string: string
	new_string: string
}

export interface ChangeLocation {
	startLine: number
	endLine: number
	startChar: number
	endChar: number
}

export class StreamingJsonReplacer {
	private currentFileContent: string
	private parser: JSONParser
	private onContentUpdated: (newContent: string, isFinalItem: boolean, changeLocation?: ChangeLocation) => void
	private onErrorCallback: (error: Error) => void
	private itemsProcessed: number = 0
	private successfullyParsedItems: ReplacementItem[] = []
	private logFilePath: string

	constructor(
		initialContent: string,
		onContentUpdatedCallback: (newContent: string, isFinalItem: boolean, changeLocation?: ChangeLocation) => void,
		onErrorCallback: (error: Error) => void,
	) {
		// Initialize log file path
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
		this.logFilePath = path.join(os.homedir(), "Documents", `streaming-json-replacer-debug-${timestamp}.log`)

		// Initialize log file
		this.log("StreamingJsonReplacer Debug Log Started", "INFO")
		this.log("Timestamp: " + new Date().toISOString(), "INFO")
		this.log("Constructor called with initial content length: " + initialContent.length, "INFO")
		this.log("Initial content preview: " + initialContent.substring(0, 200) + "...", "INFO")

		this.currentFileContent = initialContent
		this.onContentUpdated = onContentUpdatedCallback
		this.onErrorCallback = onErrorCallback

		this.log("Initializing JSONParser with paths: ['$.*']", "INFO")
		this.parser = new JSONParser({ paths: ["$.*"] })

		this.parser.onValue = (parsedElementInfo: ParsedElementInfo) => {
			this.log("onValue callback triggered")
			this.log("parsedElementInfo: " + JSON.stringify(parsedElementInfo, null, 2))

			const { value } = parsedElementInfo // Destructure to get value, which might be undefined
			this.log("Extracted value: " + JSON.stringify(value))
			this.log("Value type: " + typeof value)

			// This callback is triggered for each item matched by '$.replacements.*'
			if (value && typeof value === "object" && "old_string" in value && "new_string" in value) {
				this.log("Found valid replacement item structure")
				const item = value as ReplacementItem // Value here is confirmed to be an object
				this.log("Replacement item: " + JSON.stringify(item, null, 2))

				if (typeof item.old_string === "string" && typeof item.new_string === "string") {
					this.log("Item has valid string types for old_string and new_string")
					this.log("old_string length: " + item.old_string.length)
					this.log("new_string length: " + item.new_string.length)
					this.log(
						"old_string preview: " +
							(item.old_string.substring(0, 100) + (item.old_string.length > 100 ? "..." : "")),
					)
					this.log(
						"new_string preview: " +
							(item.new_string.substring(0, 100) + (item.new_string.length > 100 ? "..." : "")),
					)

					this.successfullyParsedItems.push(item) // Store the structurally valid item
					this.log("Added item to successfullyParsedItems. Total count: " + this.successfullyParsedItems.length)

					if (this.currentFileContent.includes(item.old_string)) {
						this.log("old_string found in current file content - proceeding with replacement")

						// Calculate the change location before making the replacement
						const changeLocation = this.calculateChangeLocation(item.old_string, item.new_string)
						this.log("Calculated change location: " + JSON.stringify(changeLocation))

						const beforeLength = this.currentFileContent.length
						this.currentFileContent = this.currentFileContent.replace(item.old_string, item.new_string)
						const afterLength = this.currentFileContent.length
						this.log("Content length before replacement: " + beforeLength)
						this.log("Content length after replacement: " + afterLength)
						this.log("Length difference: " + (afterLength - beforeLength))

						this.itemsProcessed++
						this.log("Incremented itemsProcessed to: " + this.itemsProcessed)

						// Notify that an item has been processed. The `isFinalItem` argument here is tricky
						// as we don't know from the parser alone if this is the *absolute* last item
						// until the stream ends. The caller (Task.ts) will manage the final update.
						// For now, we'll pass `false` and let Task.ts handle the final diff view update.
						this.log("Calling onContentUpdated callback")
						this.onContentUpdated(this.currentFileContent, false, changeLocation)
						this.log("onContentUpdated callback completed")
					} else {
						this.log("old_string NOT found in current file content - generating error", "ERROR")
						this.log("Current file content length: " + this.currentFileContent.length)
						this.log("Current file content preview: " + this.currentFileContent.substring(0, 200) + "...")

						const snippet = item.old_string.length > 50 ? item.old_string.substring(0, 47) + "..." : item.old_string
						const error = new Error(`Streaming Replacement failed: 'old_string' not found. Snippet: "${snippet}"`)
						this.log("Calling onErrorCallback with error: " + error.message, "ERROR")
						this.onErrorCallback(error) // Call our own error callback
					}
				} else {
					this.log(
						"Invalid string types - old_string type: " +
							typeof item.old_string +
							", new_string type: " +
							typeof item.new_string,
						"ERROR",
					)
					const error = new Error(`Invalid item structure in replacements stream: ${JSON.stringify(item)}`)
					this.log("Calling onErrorCallback with error: " + error.message, "ERROR")
					this.onErrorCallback(error) // Call our own error callback
				}
			} else if (value && (Array.isArray(value) || (typeof value === "object" && "replacements" in value))) {
				// This might be the 'replacements' array itself or the root object.
				// The `paths: ['$.replacements.*']` should mean we only get items.
				// If we get here, it's likely the root object if paths wasn't specific enough or if it's an empty replacements array.
				this.log("Streaming parser emitted container: " + JSON.stringify(value))
				this.log(
					"Container type - isArray: " +
						Array.isArray(value) +
						", hasReplacements: " +
						(typeof value === "object" && "replacements" in value),
				)
			} else {
				// Value is not a ReplacementItem or a known container, could be an issue with the JSON structure or path.
				// If `paths` is correct, this path should ideally not be hit often for valid streams.
				this.log("Streaming parser emitted unexpected value: " + JSON.stringify(value), "WARN")
				this.log("Unexpected value type: " + typeof value, "WARN")
				this.log("Has old_string: " + (value && typeof value === "object" && "old_string" in value), "WARN")
				this.log("Has new_string: " + (value && typeof value === "object" && "new_string" in value), "WARN")
			}
		}

		this.parser.onError = (err: Error) => {
			this.log("Parser onError callback triggered", "ERROR")
			this.log("Error details: " + JSON.stringify(err), "ERROR")
			this.log("Error message: " + err.message, "ERROR")
			this.log("Error stack: " + err.stack, "ERROR")

			// Propagate the error to the caller via the callback
			this.log("Calling onErrorCallback with parser error", "ERROR")
			this.onErrorCallback(err)
			// Note: The @streamparser/json library might throw synchronously on write if onError is not set,
			// or if it re-throws. We'll ensure Task.ts wraps write/end in try-catch.
		}

		this.log("Constructor completed - parser setup finished")

		// Log to console where the debug file is located
		console.log(`[StreamingJsonReplacer] Debug logging to file: ${this.logFilePath}`)
	}

	public write(jsonChunk: string): void {
		this.log("write() called")
		this.log("JSON chunk length: " + jsonChunk.length)
		this.log("JSON chunk preview: " + jsonChunk.substring(0, 200) + (jsonChunk.length > 200 ? "..." : ""))

		try {
			// Errors during write will be caught by the parser's onError or thrown.
			this.log("Calling parser.write()")
			this.parser.write(jsonChunk)
			this.log("parser.write() completed successfully")
		} catch (error) {
			this.log("Exception during parser.write(): " + error, "ERROR")
			throw error
		}
	}

	public getCurrentContent(): string {
		this.log("getCurrentContent() called")
		this.log("Current content length: " + this.currentFileContent.length)
		return this.currentFileContent
	}

	public getSuccessfullyParsedItems(): ReplacementItem[] {
		this.log("getSuccessfullyParsedItems() called")
		this.log("Returning copy of " + this.successfullyParsedItems.length + " items")
		return [...this.successfullyParsedItems] // Return a copy
	}

	private calculateChangeLocation(oldStr: string, newStr: string): ChangeLocation {
		this.log("calculateChangeLocation() called")
		this.log("oldStr length: " + oldStr.length)
		this.log("newStr length: " + newStr.length)
		this.log("oldStr preview: " + oldStr.substring(0, 50) + (oldStr.length > 50 ? "..." : ""))
		this.log("newStr preview: " + newStr.substring(0, 50) + (newStr.length > 50 ? "..." : ""))

		// Find the index where the old string starts
		const startIndex = this.currentFileContent.indexOf(oldStr)
		this.log("startIndex found: " + startIndex)

		if (startIndex === -1) {
			this.log("startIndex is -1 - old string not found in content!", "WARN")
			this.log("This shouldn't happen since we already checked includes()", "WARN")
			// This shouldn't happen since we already checked includes(), but just in case
			return { startLine: 0, endLine: 0, startChar: 0, endChar: 0 }
		}

		// Calculate line numbers by counting newlines before the start index
		const contentBeforeStart = this.currentFileContent.substring(0, startIndex)
		this.log("contentBeforeStart length: " + contentBeforeStart.length)

		const startLine = (contentBeforeStart.match(/\n/g) || []).length
		this.log("calculated startLine: " + startLine)

		// Calculate the end index after replacement
		const endIndex = startIndex + oldStr.length
		this.log("calculated endIndex: " + endIndex)

		const contentBeforeEnd = this.currentFileContent.substring(0, endIndex)
		this.log("contentBeforeEnd length: " + contentBeforeEnd.length)

		const endLine = (contentBeforeEnd.match(/\n/g) || []).length
		this.log("calculated endLine: " + endLine)

		// Calculate character positions within their respective lines
		const lastNewlineBeforeStart = contentBeforeStart.lastIndexOf("\n")
		this.log("lastNewlineBeforeStart: " + lastNewlineBeforeStart)

		const startChar = lastNewlineBeforeStart === -1 ? startIndex : startIndex - lastNewlineBeforeStart - 1
		this.log("calculated startChar: " + startChar)

		const lastNewlineBeforeEnd = contentBeforeEnd.lastIndexOf("\n")
		this.log("lastNewlineBeforeEnd: " + lastNewlineBeforeEnd)

		const endChar = lastNewlineBeforeEnd === -1 ? endIndex : endIndex - lastNewlineBeforeEnd - 1
		this.log("calculated endChar: " + endChar)

		const result = {
			startLine,
			endLine,
			startChar,
			endChar,
		}

		this.log("calculateChangeLocation() returning: " + JSON.stringify(result))
		return result
	}

	private log(message: string, level: "INFO" | "WARN" | "ERROR" = "INFO"): void {
		const timestamp = new Date().toISOString()
		const logLine = `[${timestamp}] [${level}] ${message}\n`

		try {
			fs.appendFileSync(this.logFilePath, logLine)
		} catch (error) {
			// Fallback to console if file logging fails
			console.error("Failed to write to log file:", error)
			console.log(`[${level}] ${message}`)
		}
	}
}
