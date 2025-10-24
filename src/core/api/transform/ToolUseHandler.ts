import { Anthropic } from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { JSONParser } from "@streamparser/json"

export interface PendingToolUse {
	id: string
	name: string
	input: string
	parsedInput?: unknown
	jsonParser?: JSONParser
	call_id?: string
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
	processToolUseDelta(delta: { id?: string; type?: string; name?: string; input?: string }, call_id?: string): void {
		if (delta.type !== "tool_use") {
			return
		}

		const id = delta.id
		if (!id) {
			return
		}

		// Get or create pending tool use
		let pendingToolUse = this.pendingToolUses.get(id)
		if (!pendingToolUse) {
			pendingToolUse = this.createPendingToolUse(id, delta.name || "", call_id)
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
				// If parsing fails, use empty object
				console.warn(`Failed to parse tool use input for ${pendingToolUse.name}:`, error)
				input = {}
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
			if (!pendingToolUse.name) {
				continue
			}

			// Try to parse accumulated input as params
			const params: Record<string, string> = {}
			if (pendingToolUse.parsedInput !== undefined && pendingToolUse.parsedInput !== null) {
				// Convert parsed JSON object to string params
				if (typeof pendingToolUse.parsedInput === "object") {
					for (const [key, value] of Object.entries(pendingToolUse.parsedInput)) {
						params[key] = typeof value === "string" ? value : JSON.stringify(value)
					}
				}
			} else if (pendingToolUse.input) {
				// Try to parse the partial input
				try {
					const parsed = JSON.parse(pendingToolUse.input)
					if (typeof parsed === "object") {
						for (const [key, value] of Object.entries(parsed)) {
							params[key] = typeof value === "string" ? value : JSON.stringify(value)
						}
					}
				} catch {
					// Input is incomplete JSON, leave params empty
				}
			}

			results.push({
				type: "tool_use",
				name: pendingToolUse.name as any,
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
}
