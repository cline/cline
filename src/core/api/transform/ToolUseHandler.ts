import { Anthropic } from "@anthropic-ai/sdk"
import { JSONParser } from "@streamparser/json"

export interface PendingToolUse {
	id: string
	name: string
	input: string
	parsedInput?: unknown
	jsonParser?: JSONParser
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
	processToolUseDelta(delta: { id?: string; type?: string; name?: string; input?: string }): void {
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
			pendingToolUse = this.createPendingToolUse(id, delta.name || "")
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
	 * Reset all pending tool uses (call this at the start of a new request)
	 */
	reset(): void {
		this.pendingToolUses.clear()
	}

	private createPendingToolUse(id: string, name: string): PendingToolUse {
		const jsonParser = new JSONParser()
		const pendingToolUse: PendingToolUse = {
			id,
			name,
			input: "",
			parsedInput: undefined,
			jsonParser,
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
		} catch (error) {
			// Expected during streaming - parser will error on incomplete JSON
		}
	}
}
