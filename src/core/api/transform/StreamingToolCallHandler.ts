/**
 * Shared utilities for handling streaming function calls and converting them to XML format
 */

export interface PendingToolCall {
	name?: string
	arguments: string
	yieldedText: string
	isHeaderYielded: boolean
	hasYieldedParams: boolean
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
			this.pendingToolCalls.set(callId, {
				name: toolCallDelta?.function?.name,
				arguments: "",
				yieldedText: "",
				isHeaderYielded: false,
				hasYieldedParams: false,
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

		// Try to extract and yield new parameter content as arguments stream in
		if (pendingCall.arguments) {
			if (this.debug) {
				console.log("Current arguments:", pendingCall.arguments)
				console.log("Previously yielded text:", pendingCall.yieldedText)
			}

			try {
				// Try to parse the current arguments as JSON
				const parsedArgs = JSON.parse(pendingCall.arguments)
				if (this.debug) {
					console.log("Successfully parsed JSON:", parsedArgs)
				}

				// Generate the complete XML content for parameters
				let fullParamsXml = ""
				for (const [key, value] of Object.entries(parsedArgs)) {
					if (value !== undefined && value !== null) {
						// Unescape JSON string values to convert \n to actual newlines, etc.
						const unescapedValue = typeof value === "string" ? JSON.parse(`"${value}"`) : value
						fullParamsXml += `<${key}>${unescapedValue}</${key}>\n`
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
								console.log("Yielding new JSON-parsed content:", newContent)
							}
						}
					} else {
						// If the content doesn't match what we've yielded exactly, check if we should still yield
						// This can happen due to JSON escaping differences (e.g., \\n vs \n)
						// Only yield if we haven't yielded any content for this parameter set yet
						if (!alreadyYieldedContent || alreadyYieldedContent.trim() === "") {
							newText += fullParamsXml
							if (this.debug) {
								console.log("Yielding complete JSON-parsed content (first time):", fullParamsXml)
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
			} catch (error) {
				if (this.debug) {
					console.log("JSON parse failed, trying partial content extraction:", (error as Error).message)
				}
				// If JSON is incomplete, try to stream partial content
				const currentArgs = pendingCall.arguments

				// Look for complete key-value pairs that we haven't yielded yet
				const partialMatches = currentArgs.match(/"(\w+)"\s*:\s*"([^"]*)"/g) || []
				if (this.debug) {
					console.log("Found partial matches:", partialMatches)
				}

				let partialXmlContent = ""
				for (const match of partialMatches) {
					const keyValueMatch = match.match(/"(\w+)"\s*:\s*"([^"]*)"/)
					if (keyValueMatch) {
						const [, key, value] = keyValueMatch
						// Unescape JSON string values to convert \n to actual newlines, etc.
						const unescapedValue = JSON.parse(`"${value}"`)
						partialXmlContent += `<${key}>${unescapedValue}</${key}>\n`
					}
				}

				if (this.debug) {
					console.log("Generated partial XML content:", partialXmlContent)
				}

				// Only yield new parameter content
				if (partialXmlContent && partialXmlContent !== pendingCall.yieldedText) {
					if (partialXmlContent.startsWith(pendingCall.yieldedText)) {
						const newContent = partialXmlContent.slice(pendingCall.yieldedText.length)
						if (newContent) {
							newText += newContent
							if (this.debug) {
								console.log("Yielding new partial content:", newContent)
							}
						}
					} else {
						// Only yield if we haven't yielded any content for this parameter set yet
						if (!pendingCall.yieldedText || pendingCall.yieldedText.trim() === "") {
							newText += partialXmlContent
							if (this.debug) {
								console.log("Yielding complete partial content (first time):", partialXmlContent)
							}
						} else if (this.debug) {
							console.log("Skipping duplicate partial content due to formatting differences")
						}
					}
					pendingCall.yieldedText = partialXmlContent
				}
			}
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
		}

		if (!pendingCall.name || !pendingCall.hasYieldedParams) {
			if (this.debug) {
				console.log("Skipping finalization - no name or no yielded params")
			}
			return ""
		}

		// Try to parse the final JSON and yield any remaining parameters
		if (pendingCall.arguments) {
			try {
				const parsedArgs = JSON.parse(pendingCall.arguments)
				if (this.debug) {
					console.log("Final JSON parse successful:", parsedArgs)
				}

				// Generate the complete XML content for parameters
				let fullParamsXml = ""
				for (const [key, value] of Object.entries(parsedArgs)) {
					if (value !== undefined && value !== null) {
						// Unescape JSON string values to convert \n to actual newlines, etc.
						const unescapedValue = typeof value === "string" ? JSON.parse(`"${value}"`) : value
						fullParamsXml += `<${key}>${unescapedValue}</${key}>\n`
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
			} catch (error) {
				if (this.debug) {
					console.log("Final JSON parse failed:", (error as Error).message)
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
