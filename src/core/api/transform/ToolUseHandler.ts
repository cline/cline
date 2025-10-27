import { Anthropic } from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { JSONParser } from "@streamparser/json"
import { CLINE_MCP_TOOL_IDENTIFIER } from "@/shared/mcp"
import { ClineDefaultTool } from "@/shared/tools"

export interface PendingToolUse {
	id: string
	name: string
	input: string
	parsedInput?: unknown
	jsonParser?: JSONParser
	call_id?: string
}

interface ToolUseDeltaBlock {
	id?: string
	type?: string
	name?: string
	input?: string
}

/**
 * Handles streaming tool use blocks and converts them to Anthropic.ToolUseBlockParam format
 */
export class ToolUseHandler {
	private pendingToolUses: Map<string, PendingToolUse> = new Map()

	/**
	 * Process a tool use delta chunk and accumulate it
	 * @param delta - The streaming delta containing tool use information
	 */
	processToolUseDelta(delta: ToolUseDeltaBlock, call_id?: string): void {
		if (delta.type !== "tool_use") {
			return
		}

		const deltaID = delta.id
		if (!deltaID) {
			return
		}

		// Get or create pending tool use
		let pendingToolUse = this.pendingToolUses.get(deltaID)
		if (!pendingToolUse) {
			pendingToolUse = this.createPendingToolUse(deltaID, delta.name || "", call_id)
		}

		// Update name if provided
		if (delta.name) {
			pendingToolUse.name = delta.name
		}

		// Accumulate and parse input
		if (delta.input) {
			pendingToolUse.input += delta.input
			this.feedJsonParser(pendingToolUse, delta.input)
		}
	}

	/**
	 * Get a finalized tool use block for a given ID
	 * @param id - The tool use ID
	 * @returns The complete ToolUseBlockParam or undefined if not ready
	 */
	getFinalizedToolUse(id: string): Anthropic.ToolUseBlockParam | undefined {
		const pendingToolUse = this.pendingToolUses.get(id)
		if (!pendingToolUse || !pendingToolUse.name) {
			return undefined
		}

		// Try to parse the accumulated input as JSON
		let input: unknown = {}

		// First try using the streaming parser result
		if (pendingToolUse.parsedInput !== undefined && pendingToolUse.parsedInput !== null) {
			input = pendingToolUse.parsedInput
		} else if (pendingToolUse.input) {
			// Fallback to manual JSON parse
			try {
				input = JSON.parse(pendingToolUse.input)
			} catch (error) {
				// If parsing fails, try to extract partial field values
				// This is especially important for tools with large string inputs like apply_patch
				console.warn(`Failed to parse tool use input for ${pendingToolUse.name}, attempting partial extraction:`, error)
				input = this.extractPartialJsonFields(pendingToolUse.input)
			}
		}

		return {
			type: "tool_use",
			id: pendingToolUse.id,
			name: pendingToolUse.name,
			input,
		}
	}

	/**
	 * Get all finalized tool uses
	 * @returns Array of complete ToolUseBlockParam
	 */
	getAllFinalizedToolUses(): Anthropic.ToolUseBlockParam[] {
		const results: Anthropic.ToolUseBlockParam[] = []
		for (const id of this.pendingToolUses.keys()) {
			const toolUse = this.getFinalizedToolUse(id)
			if (toolUse) {
				results.push(toolUse)
			}
		}
		return results
	}

	/**
	 * Check if a tool use exists and is being tracked
	 */
	hasToolUse(id: string): boolean {
		return this.pendingToolUses.has(id)
	}

	/**
	 * Get all pending tool uses as AssistantMessageContent blocks
	 * Used for streaming UI updates with native tool calls
	 * @returns Array of partial ToolUse blocks
	 */
	getPartialToolUsesAsContent(): ToolUse[] {
		const results: ToolUse[] = []
		for (const pendingToolUse of this.pendingToolUses.values()) {
			const toolName = pendingToolUse.name
			if (!toolName) {
				continue
			}

			// Get the original parsed input or try to parse it
			let originalInput: any = {}
			if (pendingToolUse.parsedInput !== undefined && pendingToolUse.parsedInput !== null) {
				originalInput = pendingToolUse.parsedInput
			} else if (pendingToolUse.input) {
				// Try to parse the partial input
				try {
					originalInput = JSON.parse(pendingToolUse.input)
				} catch {
					// Input is incomplete JSON - try to extract partial field values
					// This is especially important for tools with large string inputs like apply_patch
					originalInput = this.extractPartialJsonFields(pendingToolUse.input)
				}
			}

			// Try to parse accumulated input as params (for non-MCP tools)
			const params: Record<string, string> = {}
			if (typeof originalInput === "object") {
				for (const [key, value] of Object.entries(originalInput)) {
					params[key] = typeof value === "string" ? value : JSON.stringify(value)
				}
			}

			if (toolName.includes(CLINE_MCP_TOOL_IDENTIFIER)) {
				const mcpToolParts = toolName.split(CLINE_MCP_TOOL_IDENTIFIER)

				results.push({
					type: "tool_use",
					name: ClineDefaultTool.MCP_USE,
					params: {
						server_name: mcpToolParts[0],
						tool_name: mcpToolParts[1],
						arguments: JSON.stringify(originalInput),
					},
					partial: true, // Always partial during streaming
				})
				continue
			}

			results.push({
				type: "tool_use",
				name: toolName as ClineDefaultTool,
				params: params as any, // Cast to Partial<Record<ToolParamName, string>>
				partial: true, // Always partial during streaming
			})
		}
		return results
	}

	/**
	 * Reset all pending tool uses (call this at the start of a new request)
	 */
	reset(): void {
		this.pendingToolUses.clear()
	}

	private createPendingToolUse(id: string, name: string, call_id?: string): PendingToolUse {
		const jsonParser = new JSONParser()
		const pendingToolUse: PendingToolUse = {
			id,
			name,
			input: "",
			parsedInput: undefined,
			jsonParser,
			call_id,
		}

		jsonParser.onValue = (parsedElementInfo: any) => {
			// Only capture top-level complete objects
			if (parsedElementInfo.stack.length === 0 && parsedElementInfo.value && typeof parsedElementInfo.value === "object") {
				pendingToolUse.parsedInput = parsedElementInfo.value
			}
		}

		jsonParser.onError = () => {
			// Ignore errors for incomplete JSON during streaming
		}

		this.pendingToolUses.set(id, pendingToolUse)
		return pendingToolUse
	}

	private feedJsonParser(pendingToolUse: PendingToolUse, input: string): void {
		if (!pendingToolUse.jsonParser) {
			return
		}
		try {
			pendingToolUse.jsonParser.write(input)
		} catch {
			// Expected during streaming - parser will error on incomplete JSON
		}
	}

	/**
	 * Extracts partial field values from incomplete JSON strings
	 * This is useful during streaming when JSON.parse() would fail
	 * @param partialJson - Incomplete JSON string (e.g., '{"input": "some val...')
	 * @returns Object with extracted field values
	 */
	private extractPartialJsonFields(partialJson: string): Record<string, any> {
		const result: Record<string, any> = {}

		// Try to extract field values using regex patterns
		// Pattern: "fieldName": "value..." or "fieldName": value...
		const stringFieldPattern = /"(\w+)":\s*"((?:[^"\\]|\\.)*)(?:")?/g
		const matches = partialJson.matchAll(stringFieldPattern)

		for (const match of matches) {
			const fieldName = match[1]
			let fieldValue = match[2]

			// Unescape common JSON escape sequences
			fieldValue = fieldValue
				.replace(/\\n/g, "\n")
				.replace(/\\t/g, "\t")
				.replace(/\\r/g, "\r")
				.replace(/\\"/g, '"')
				.replace(/\\\\/g, "\\")

			result[fieldName] = fieldValue
		}

		return result
	}
}
