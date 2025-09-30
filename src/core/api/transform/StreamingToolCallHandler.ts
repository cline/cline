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
	private debug: boolean = IS_DEV

	/**
	 * Process a streaming tool call delta and return any XML content to yield
	 */
	processToolCallDelta(toolCallDelta: ToolCallDelta): string | null {
		if (this.debug) {
			console.log("toolCallDelta received:", JSON.stringify(toolCallDelta, null, 2))
		}

		let callId = toolCallDelta.id || this.lastPendingToolCallId

		// Initialize or update the pending tool call
		if (callId && !this.pendingToolCalls.has(callId)) {
			if (this.debug) {
				console.log("Creating new pending tool call for ID:", callId)
			}
			this.lastPendingToolCallId = callId

			// Create a new JSON parser for this tool call
			const jsonParser = new JSONParser()

			jsonParser.onValue = (parsedElementInfo: any) => {
				// Only capture top-level objects (complete JSON objects)
				if (
					parsedElementInfo.stack.length === 0 &&
					parsedElementInfo.value &&
					typeof parsedElementInfo.value === "object"
				) {
					const pendingCall = this.pendingToolCalls.get(callId!)
					if (pendingCall) {
						pendingCall.parsedArgs = parsedElementInfo.value
					}
				}
			}

			jsonParser.onError = () => {
				// Ignore errors for incomplete JSON - this is expected during streaming
				if (this.debug) {
					console.log("JSON parser error (expected during streaming)")
				}
			}

			this.pendingToolCalls.set(callId, {
				name: toolCallDelta?.function?.name,
				arguments: "",
				yieldedText: "",
				isHeaderYielded: false,
				hasYieldedParams: false,
				jsonParser,
				parsedArgs: null,
			})
		} else if (!callId && this.lastPendingToolCallId) {
			// Use the last pending tool call ID if no ID is provided
			callId = this.lastPendingToolCallId
			if (this.debug) {
				console.log("Using last pending tool call ID:", callId)
			}
		}

		const pendingCall = this.pendingToolCalls.get(callId || "")
		if (this.debug) {
			console.log("Current pending call state:", pendingCall)
		}

		if (pendingCall) {
			// Update function name if provided
			if (toolCallDelta.function?.name) {
				if (this.debug) {
					console.log("Updating function name to:", toolCallDelta.function.name)
				}
				pendingCall.name = toolCallDelta.function.name
			}

			// Accumulate arguments
			if (toolCallDelta.function?.arguments) {
				if (this.debug) {
					console.log("Adding arguments:", toolCallDelta.function.arguments)
				}
				pendingCall.arguments += toolCallDelta.function.arguments

				// Feed the new arguments to the JSON parser
				if (pendingCall.jsonParser) {
					try {
						pendingCall.jsonParser.write(toolCallDelta.function.arguments)
					} catch (error) {
						if (this.debug) {
							console.log("JSON parser write error (expected during streaming):", (error as Error).message)
						}
					}
				}

				if (this.debug) {
					console.log("Total arguments now:", pendingCall.arguments)
				}
			}

			// Generate and return streaming XML content as it arrives
			const streamingXml = this.generateStreamingToolXml(pendingCall)
			if (streamingXml && this.debug) {
				console.log("Generated streaming tool XML:", streamingXml)
			}
			return streamingXml
		} else {
			if (this.debug) {
				console.log("No pending call found for ID:", callId)
			}
		}

		return null
	}

	/**
	 * Finalize all pending tool calls and return any remaining XML content
	 */
	finalizePendingToolCalls(): string[] {
		const results: string[] = []

		for (const [, pendingCall] of this.pendingToolCalls.entries()) {
			const finalXml = this.finalizeToolXml(pendingCall)
			if (finalXml) {
				if (this.debug) {
					console.log("Yielding finalized tool XML:", finalXml)
				}
				results.push(finalXml)
			}
		}

		return results
	}

	/**
	 * Reset all pending tool calls (call this at the start of a new request)
	 */
	reset() {
		this.pendingToolCalls.clear()
		this.lastPendingToolCallId = undefined
	}

	private generateStreamingToolXml(pendingCall: PendingToolCall): string {
		let newText = ""

		// Only proceed if we have a tool name
		if (!pendingCall.name) {
			return ""
		}

		// Yield opening tag when we first get the tool name
		if (!pendingCall.isHeaderYielded) {
			newText += `<${pendingCall.name}>\n`
			pendingCall.isHeaderYielded = true
			pendingCall.hasYieldedParams = true // Set this to true so we start yielding content
		}

		// Use the parsed arguments from the streaming JSON parser
		if (pendingCall.parsedArgs) {
			if (this.debug) {
				console.log("Using parsed args from streaming parser:", pendingCall.parsedArgs)
				console.log("Previously yielded text:", pendingCall.yieldedText)
			}

			// Generate the complete XML content for parameters
			let fullParamsXml = ""
			for (const [key, value] of Object.entries(pendingCall.parsedArgs)) {
				if (value !== undefined && value !== null) {
					// Handle string values that might contain special characters
					const stringValue = typeof value === "string" ? value : String(value)
					fullParamsXml += `<${key}>${stringValue}</${key}>\n`
				}
			}

			// Only yield the new part that hasn't been yielded yet
			if (fullParamsXml !== pendingCall.yieldedText) {
				const alreadyYieldedContent = pendingCall.yieldedText
				if (fullParamsXml.startsWith(alreadyYieldedContent)) {
					const newContent = fullParamsXml.slice(alreadyYieldedContent.length)
					if (newContent) {
						newText += newContent
						if (this.debug) {
							console.log("Yielding new parsed content:", newContent)
						}
					}
				} else {
					// If the content doesn't match what we've yielded exactly, check if we should still yield
					// Only yield if we haven't yielded any content for this parameter set yet
					if (!alreadyYieldedContent || alreadyYieldedContent.trim() === "") {
						newText += fullParamsXml
						if (this.debug) {
							console.log("Yielding complete parsed content (first time):", fullParamsXml)
						}
					} else if (this.debug) {
						console.log(
							"Skipping duplicate content due to formatting differences. Already yielded:",
							alreadyYieldedContent.length,
							"chars, new content:",
							fullParamsXml.length,
							"chars",
						)
					}
				}
				pendingCall.yieldedText = fullParamsXml
			}
		} else if (this.debug) {
			console.log("No parsed args available yet from streaming parser")
		}

		// Return the new content to yield
		return newText
	}

	private finalizeToolXml(pendingCall: PendingToolCall): string {
		if (this.debug) {
			console.log("Finalizing tool XML for:", pendingCall.name)
			console.log("Final arguments:", pendingCall.arguments)
			console.log("Final yielded text:", pendingCall.yieldedText)
			console.log("Has yielded params:", pendingCall.hasYieldedParams)
			console.log("Final parsed args:", pendingCall.parsedArgs)
		}

		if (!pendingCall.name || !pendingCall.hasYieldedParams) {
			if (this.debug) {
				console.log("Skipping finalization - no name or no yielded params")
			}
			return ""
		}

		// Try to get any final parsed arguments and yield any remaining parameters
		if (pendingCall.parsedArgs) {
			// Generate the complete XML content for parameters
			let fullParamsXml = ""
			for (const [key, value] of Object.entries(pendingCall.parsedArgs)) {
				if (value !== undefined && value !== null) {
					const stringValue = typeof value === "string" ? value : String(value)
					fullParamsXml += `<${key}>${stringValue}</${key}>\n`
				}
			}

			// If we have more content than what was yielded, yield the remaining
			if (fullParamsXml !== pendingCall.yieldedText && fullParamsXml.startsWith(pendingCall.yieldedText)) {
				const remainingContent = fullParamsXml.slice(pendingCall.yieldedText.length)
				if (remainingContent) {
					if (this.debug) {
						console.log("Yielding remaining content in finalize:", remainingContent)
					}
					return remainingContent + `</${pendingCall.name}>`
				}
			}
		}

		// Only yield closing tag if we've yielded the header and haven't already closed the tool
		if (pendingCall.isHeaderYielded && !pendingCall.yieldedText.includes(`</${pendingCall.name}>`)) {
			// Ensure any incomplete parameter tags are properly closed before closing the tool
			let finalContent = ""

			// Check if we have any unclosed parameter tags in the yielded text
			const openTags = (pendingCall.yieldedText.match(/<(\w+)>/g) || []).map((tag) => tag.slice(1, -1))
			const closeTags = (pendingCall.yieldedText.match(/<\/(\w+)>/g) || []).map((tag) => tag.slice(2, -1))

			// Find parameters that are opened but not closed (excluding the main tool name)
			const unclosedParams = openTags.filter((tag) => tag !== pendingCall.name && !closeTags.includes(tag))

			if (this.debug) {
				console.log("Open tags:", openTags)
				console.log("Close tags:", closeTags)
				console.log("Unclosed params:", unclosedParams)
			}

			// Close any unclosed parameter tags
			for (const param of unclosedParams) {
				finalContent += `</${param}>\n`
			}

			// Add the main tool closing tag
			finalContent += `</${pendingCall.name}>`

			if (this.debug) {
				console.log("Final content to yield:", finalContent)
			}
			return finalContent
		}

		if (this.debug) {
			console.log("No finalization needed")
		}
		return ""
	}
}
