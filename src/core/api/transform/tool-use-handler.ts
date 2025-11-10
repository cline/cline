import { Anthropic } from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { JSONParser } from "@streamparser/json"
import { McpHub } from "@/services/mcp/McpHub"
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

const ESCAPE_MAP: Record<string, string> = {
	"\\n": "\n",
	"\\t": "\t",
	"\\r": "\r",
	'\\"': '"',
	"\\\\": "\\",
}

const ESCAPE_PATTERN = /\\[ntr"\\]/g

/**
 * Handles streaming native tool use blocks and converts them to Anthropic.ToolUseBlockParam format
 */
export class ToolUseHandler {
	private pendingToolUses = new Map<string, PendingToolUse>()

	processToolUseDelta(delta: ToolUseDeltaBlock, call_id?: string): void {
		if (delta.type !== "tool_use" || !delta.id) {
			return
		}

		let pending = this.pendingToolUses.get(delta.id)
		if (!pending) {
			pending = this.createPendingToolUse(delta.id, delta.name || "", call_id)
		}

		if (delta.name) {
			pending.name = delta.name
		}
		if (delta.input) {
			pending.input += delta.input
			try {
				pending.jsonParser?.write(delta.input)
			} catch {
				// Expected during streaming
			}
		}
	}

	getFinalizedToolUse(id: string): Anthropic.ToolUseBlockParam | undefined {
		const pending = this.pendingToolUses.get(id)
		if (!pending?.name) {
			return undefined
		}

		let input: unknown = {}
		if (pending.parsedInput != null) {
			input = pending.parsedInput
		} else if (pending.input) {
			try {
				input = JSON.parse(pending.input)
			} catch {
				input = this.extractPartialJsonFields(pending.input)
			}
		}

		return {
			type: "tool_use",
			id: pending.id,
			name: pending.name,
			input,
		}
	}

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

	hasToolUse(id: string): boolean {
		return this.pendingToolUses.has(id)
	}

	getPartialToolUsesAsContent(): ToolUse[] {
		const results: ToolUse[] = []

		for (const pending of this.pendingToolUses.values()) {
			if (!pending.name) {
				continue
			}

			let input: any = {}
			if (pending.parsedInput != null) {
				input = pending.parsedInput
			} else if (pending.input) {
				try {
					input = JSON.parse(pending.input)
				} catch {
					input = this.extractPartialJsonFields(pending.input)
				}
			}

			if (pending.name.includes(CLINE_MCP_TOOL_IDENTIFIER)) {
				const [key, toolName] = pending.name.split(CLINE_MCP_TOOL_IDENTIFIER)
				results.push({
					type: "tool_use",
					name: ClineDefaultTool.MCP_USE,
					params: {
						server_name: McpHub.getMcpServerByKey(key),
						tool_name: toolName,
						arguments: JSON.stringify(input),
					},
					partial: true,
					isNativeToolCall: true,
				})
			} else {
				const params: Record<string, string> = {}
				if (typeof input === "object") {
					for (const [key, value] of Object.entries(input)) {
						params[key] = typeof value === "string" ? value : JSON.stringify(value)
					}
				}
				results.push({
					type: "tool_use",
					name: pending.name as ClineDefaultTool,
					params: params as any,
					partial: true,
					isNativeToolCall: true,
				})
			}
		}

		return results
	}

	reset(): void {
		this.pendingToolUses.clear()
	}

	private createPendingToolUse(id: string, name: string, call_id?: string): PendingToolUse {
		const jsonParser = new JSONParser()
		const pending: PendingToolUse = {
			id,
			name,
			input: "",
			parsedInput: undefined,
			jsonParser,
			call_id,
		}

		jsonParser.onValue = (info: any) => {
			if (info.stack.length === 0 && info.value && typeof info.value === "object") {
				pending.parsedInput = info.value
			}
		}

		jsonParser.onError = () => {}

		this.pendingToolUses.set(id, pending)
		return pending
	}

	private extractPartialJsonFields(partialJson: string): Record<string, any> {
		const result: Record<string, any> = {}
		const pattern = /"(\w+)":\s*"((?:[^"\\]|\\.)*)(?:")?/g

		for (const match of partialJson.matchAll(pattern)) {
			result[match[1]] = match[2].replace(ESCAPE_PATTERN, (m) => ESCAPE_MAP[m])
		}

		return result
	}
}
