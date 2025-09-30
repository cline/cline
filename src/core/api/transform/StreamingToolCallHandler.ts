import { JSONParser } from "@streamparser/json"

export interface PendingToolCall {
	name?: string
	arguments: string
	yieldedText: string
	isHeaderYielded: boolean
	hasYieldedParams: boolean
	jsonParser?: JSONParser
	parsedArgs?: any
}

export interface ToolCallDelta {
	id?: string
	index?: number
	type?: string
	function?: {
		name?: string
		arguments?: string
	}
}

const IS_DEV = process.env.IS_DEV === "true"

/**
 * Shared utilities for handling streaming function calls and converting them to XML format
 */
export class StreamingToolCallHandler {
	private pendingToolCalls: Map<string, PendingToolCall> = new Map()
	private lastPendingToolCallId: string | undefined
	private readonly debug: boolean = IS_DEV

	/**
	 * Process a streaming tool call delta and return any XML content to yield
	 */
	processToolCallDelta(toolCallDelta: ToolCallDelta): string | null {
		this.log("toolCallDelta received:", toolCallDelta)

		const callId = toolCallDelta.id || this.lastPendingToolCallId
		if (!callId) {
			this.log("No call ID available")
			return null
		}

		// Get or create pending call
		let pendingCall = this.pendingToolCalls.get(callId)
		if (!pendingCall) {
			this.log("Creating new pending tool call for ID:", callId)
			this.lastPendingToolCallId = callId
			pendingCall = this.createPendingCall(callId, toolCallDelta.function?.name)
		}

		this.log("Current pending call state:", pendingCall)

		// Update function name if provided
		const funcName = toolCallDelta.function?.name
		if (funcName) {
			this.log("Updating function name to:", funcName)
			pendingCall.name = funcName
		}

		// Accumulate and parse arguments
		const funcArgs = toolCallDelta.function?.arguments
		if (funcArgs) {
			this.log("Adding arguments:", funcArgs)
			pendingCall.arguments += funcArgs
			this.feedJsonParser(pendingCall, funcArgs)
			this.log("Total arguments now:", pendingCall.arguments)
		}

		// Generate and return streaming XML
		const streamingXml = this.generateStreamingToolXml(pendingCall)
		if (streamingXml) {
			this.log("Generated streaming tool XML:", streamingXml)
		}
		return streamingXml
	}

	/**
	 * Finalize all pending tool calls and return any remaining XML content
	 */
	finalizePendingToolCalls(): string[] {
		const results: string[] = []
		for (const pendingCall of this.pendingToolCalls.values()) {
			const finalXml = this.finalizeToolXml(pendingCall)
			if (finalXml) {
				this.log("Yielding finalized tool XML:", finalXml)
				results.push(finalXml)
			}
		}
		return results
	}

	/**
	 * Reset all pending tool calls (call this at the start of a new request)
	 */
	reset(): void {
		this.pendingToolCalls.clear()
		this.lastPendingToolCallId = undefined
	}

	private createPendingCall(callId: string, name?: string): PendingToolCall {
		const jsonParser = new JSONParser()
		const pendingCall: PendingToolCall = {
			name,
			arguments: "",
			yieldedText: "",
			isHeaderYielded: false,
			hasYieldedParams: false,
			jsonParser,
			parsedArgs: null,
		}

		jsonParser.onValue = (parsedElementInfo: any) => {
			// Only capture top-level complete objects
			if (parsedElementInfo.stack.length === 0 && parsedElementInfo.value && typeof parsedElementInfo.value === "object") {
				pendingCall.parsedArgs = parsedElementInfo.value
			}
		}

		jsonParser.onError = () => {
			// Ignore errors for incomplete JSON during streaming
			this.log("JSON parser error (expected during streaming)")
		}

		this.pendingToolCalls.set(callId, pendingCall)
		return pendingCall
	}

	private feedJsonParser(pendingCall: PendingToolCall, args: string): void {
		if (!pendingCall.jsonParser) {
			return
		}
		try {
			pendingCall.jsonParser.write(args)
		} catch (error) {
			this.log("JSON parser write error (expected during streaming):", (error as Error).message)
		}
	}

	private generateStreamingToolXml(pendingCall: PendingToolCall): string {
		if (!pendingCall.name) {
			return ""
		}

		const parts: string[] = []

		// Yield opening tag on first call
		if (!pendingCall.isHeaderYielded) {
			parts.push(`<${pendingCall.name}>\n`)
			pendingCall.isHeaderYielded = true
			pendingCall.hasYieldedParams = true
		}

		// Generate XML from parsed arguments
		if (pendingCall.parsedArgs) {
			this.log("Using parsed args from streaming parser:", pendingCall.parsedArgs)
			this.log("Previously yielded text:", pendingCall.yieldedText)

			const fullParamsXml = this.buildParamsXml(pendingCall.parsedArgs)

			// Only yield new content
			if (fullParamsXml !== pendingCall.yieldedText) {
				const newContent = this.extractNewContent(fullParamsXml, pendingCall.yieldedText)
				if (newContent) {
					parts.push(newContent)
					this.log("Yielding new parsed content:", newContent)
				}
				pendingCall.yieldedText = fullParamsXml
			}
		} else {
			this.log("No parsed args available yet from streaming parser")
		}

		return parts.join("")
	}

	private buildParamsXml(parsedArgs: any): string {
		const parts: string[] = []
		for (const [key, value] of Object.entries(parsedArgs)) {
			if (value !== undefined && value !== null) {
				const stringValue = typeof value === "string" ? value : String(value)
				parts.push(`<${key}>${stringValue}</${key}>\n`)
			}
		}
		return parts.join("")
	}

	private extractNewContent(fullContent: string, yieldedContent: string): string {
		if (fullContent.startsWith(yieldedContent)) {
			return fullContent.slice(yieldedContent.length)
		}
		// Only yield if nothing has been yielded yet
		if (!yieldedContent || !yieldedContent.trim()) {
			this.log("Yielding complete parsed content (first time):", fullContent)
			return fullContent
		}
		this.log(
			"Skipping duplicate content due to formatting differences. Already yielded:",
			yieldedContent.length,
			"chars, new content:",
			fullContent.length,
			"chars",
		)
		return ""
	}

	private finalizeToolXml(pendingCall: PendingToolCall): string {
		this.log("Finalizing tool XML for:", pendingCall.name)
		this.log("Final arguments:", pendingCall.arguments)
		this.log("Final yielded text:", pendingCall.yieldedText)
		this.log("Has yielded params:", pendingCall.hasYieldedParams)
		this.log("Final parsed args:", pendingCall.parsedArgs)

		if (!pendingCall.name || !pendingCall.hasYieldedParams) {
			this.log("Skipping finalization - no name or no yielded params")
			return ""
		}

		// Yield any remaining parsed content
		if (pendingCall.parsedArgs) {
			const fullParamsXml = this.buildParamsXml(pendingCall.parsedArgs)
			if (fullParamsXml !== pendingCall.yieldedText && fullParamsXml.startsWith(pendingCall.yieldedText)) {
				const remainingContent = fullParamsXml.slice(pendingCall.yieldedText.length)
				if (remainingContent) {
					this.log("Yielding remaining content in finalize:", remainingContent)
					return `${remainingContent}</${pendingCall.name}>`
				}
			}
		}

		// Close any unclosed tags
		if (pendingCall.isHeaderYielded && !pendingCall.yieldedText.includes(`</${pendingCall.name}>`)) {
			const parts: string[] = []
			const unclosedParams = this.findUnclosedParams(pendingCall)

			this.log("Unclosed params:", unclosedParams)

			// Close unclosed parameter tags
			for (const param of unclosedParams) {
				parts.push(`</${param}>\n`)
			}

			// Add main tool closing tag
			parts.push(`</${pendingCall.name}>`)

			const finalContent = parts.join("")
			this.log("Final content to yield:", finalContent)
			return finalContent
		}

		this.log("No finalization needed")
		return ""
	}

	private findUnclosedParams(pendingCall: PendingToolCall): string[] {
		const text = pendingCall.yieldedText
		const openTagRegex = /<(\w+)>/g
		const closeTagRegex = /<\/(\w+)>/g

		const openTags: string[] = []
		const closeTags: string[] = []

		let match: RegExpExecArray | null
		match = openTagRegex.exec(text)
		while (match !== null) {
			openTags.push(match[1])
			match = openTagRegex.exec(text)
		}
		match = closeTagRegex.exec(text)
		while (match !== null) {
			closeTags.push(match[1])
			match = closeTagRegex.exec(text)
		}

		this.log("Open tags:", openTags)
		this.log("Close tags:", closeTags)

		// Find tags that are opened but not closed (excluding the main tool name)
		return openTags.filter((tag) => tag !== pendingCall.name && !closeTags.includes(tag))
	}

	private log(...args: any[]): void {
		if (this.debug) {
			console.log(...args)
		}
	}
}
