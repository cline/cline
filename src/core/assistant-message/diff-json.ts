import { JSONParser } from "@streamparser/json"

// Fallback type definition based on the error message: "Property 'value' is optional in type 'ParsedElementInfo'"
type ParsedElementInfo = {
	value?: any
	key?: string | number
	parent?: any
	stack?: any[]
}

export interface ReplacementItem {
	old_str: string
	new_str: string
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
						// Calculate the change location before making the replacement
						const changeLocation = this.calculateChangeLocation(item.old_str, item.new_str)

						this.currentFileContent = this.currentFileContent.replace(item.old_str, item.new_str)
						this.itemsProcessed++
						// Notify that an item has been processed. The `isFinalItem` argument here is tricky
						// as we don't know from the parser alone if this is the *absolute* last item
						// until the stream ends. The caller (Task.ts) will manage the final update.
						// For now, we'll pass `false` and let Task.ts handle the final diff view update.
						this.onContentUpdated(this.currentFileContent, false, changeLocation)
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
				console.log("Streaming parser emitted container:", value)
			} else {
				// Value is not a ReplacementItem or a known container, could be an issue with the JSON structure or path.
				// If `paths` is correct, this path should ideally not be hit often for valid streams.
				console.warn("Streaming parser emitted unexpected value:", value)
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
		// Errors during write will be caught by the parser's onError or thrown.
		this.parser.write(jsonChunk)
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

		return {
			startLine,
			endLine,
			startChar,
			endChar,
		}
	}
}
