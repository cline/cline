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

	constructor(
		initialContent: string,
		onContentUpdatedCallback: (newContent: string, isFinalItem: boolean, changeLocation?: ChangeLocation) => void,
		onErrorCallback: (error: Error) => void,
	) {
		// Initialize log file path
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-")

		this.currentFileContent = initialContent
		this.onContentUpdated = onContentUpdatedCallback
		this.onErrorCallback = onErrorCallback

		this.parser = new JSONParser({ paths: ["$.*"] })

		this.parser.onValue = (parsedElementInfo: ParsedElementInfo) => {
			const { value } = parsedElementInfo // Destructure to get value, which might be undefined

			// This callback is triggered for each item matched by '$.replacements.*'
			if (value && typeof value === "object" && "old_string" in value && "new_string" in value) {
				const item = value as ReplacementItem // Value here is confirmed to be an object
				if (typeof item.old_string === "string" && typeof item.new_string === "string") {
					this.successfullyParsedItems.push(item) // Store the structurally valid item

					if (this.currentFileContent.includes(item.old_string)) {
						// Calculate the change location before making the replacement
						const changeLocation = this.calculateChangeLocation(item.old_string, item.new_string)

						const beforeLength = this.currentFileContent.length
						this.currentFileContent = this.currentFileContent.replace(item.old_string, item.new_string)
						const afterLength = this.currentFileContent.length

						this.itemsProcessed++

						// Notify that an item has been processed. The `isFinalItem` argument here is tricky
						// as we don't know from the parser alone if this is the *absolute* last item
						// until the stream ends. The caller (Task.ts) will manage the final update.
						// For now, we'll pass `false` and let Task.ts handle the final diff view update.
						this.onContentUpdated(this.currentFileContent, false, changeLocation)
					} else {
						const snippet = item.old_string.length > 50 ? item.old_string.substring(0, 47) + "..." : item.old_string
						const error = new Error(`Streaming Replacement failed: 'old_string' not found. Snippet: "${snippet}"`)
						this.onErrorCallback(error) // Call our own error callback
					}
				} else {
					const error = new Error(`Invalid item structure in replacements stream: ${JSON.stringify(item)}`)
					this.onErrorCallback(error) // Call our own error callback
				}
			}
		}

		this.parser.onError = (err: Error) => {
			// Propagate the error to the caller via the callback
			this.onErrorCallback(err)
			// Note: The @streamparser/json library might throw synchronously on write if onError is not set,
			// or if it re-throws. We'll ensure Task.ts wraps write/end in try-catch.
		}
	}

	public write(jsonChunk: string): void {
		try {
			// Errors during write will be caught by the parser's onError or thrown.
			this.parser.write(jsonChunk)
		} catch (error) {
			throw error
		}
	}

	public getCurrentContent(): string {
		return this.currentFileContent
	}

	public getSuccessfullyParsedItems(): ReplacementItem[] {
		return [...this.successfullyParsedItems] // Return a copy
	}

	private calculateChangeLocation(oldStr: string, newStr: string): ChangeLocation {
		// Find the index where the old string starts
		const startIndex = this.currentFileContent.indexOf(oldStr)

		if (startIndex === -1) {
			// This shouldn't happen since we already checked includes(), but just in case
			return { startLine: 0, endLine: 0, startChar: 0, endChar: 0 }
		}

		// Calculate line numbers by counting newlines before the start index
		const contentBeforeStart = this.currentFileContent.substring(0, startIndex)

		const startLine = (contentBeforeStart.match(/\n/g) || []).length
		// Calculate the end index after replacement
		const endIndex = startIndex + oldStr.length

		const contentBeforeEnd = this.currentFileContent.substring(0, endIndex)

		const endLine = (contentBeforeEnd.match(/\n/g) || []).length
		// Calculate character positions within their respective lines
		const lastNewlineBeforeStart = contentBeforeStart.lastIndexOf("\n")
		const startChar = lastNewlineBeforeStart === -1 ? startIndex : startIndex - lastNewlineBeforeStart - 1

		const lastNewlineBeforeEnd = contentBeforeEnd.lastIndexOf("\n")

		const endChar = lastNewlineBeforeEnd === -1 ? endIndex : endIndex - lastNewlineBeforeEnd - 1

		const result = {
			startLine,
			endLine,
			startChar,
			endChar,
		}

		return result
	}
}
