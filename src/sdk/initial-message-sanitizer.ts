type GenericContentBlock = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toBlocks(content: unknown): GenericContentBlock[] {
	if (Array.isArray(content)) {
		return content.filter(isRecord)
	}
	if (typeof content === "string") {
		return [{ type: "text", text: content }]
	}
	return []
}

function getToolUseIds(content: unknown): string[] {
	if (!Array.isArray(content)) {
		return []
	}

	const ids: string[] = []
	for (const block of content) {
		if (!isRecord(block)) {
			continue
		}
		if (block.type === "tool_use" && typeof block.id === "string") {
			ids.push(block.id)
		}
	}
	return ids
}

function isToolResultForId(block: GenericContentBlock, toolUseId: string): boolean {
	return block.type === "tool_result" && block.tool_use_id === toolUseId
}

const MIGRATION_MISSING_TOOL_RESULT_TEXT = "[migration] Tool result missing in legacy conversation history."

function createMissingToolResult(toolUseId: string): GenericContentBlock {
	return {
		type: "tool_result",
		tool_use_id: toolUseId,
		content: MIGRATION_MISSING_TOOL_RESULT_TEXT,
	}
}

function isMigrationPlaceholderToolResult(block: GenericContentBlock): boolean {
	return block.type === "tool_result" && block.content === MIGRATION_MISSING_TOOL_RESULT_TEXT
}

/**
 * Ensures pre-SDK conversation messages satisfy strict tool-use pairing rules.
 *
 * SDK runtime validation expects every assistant tool_use block to have matching
 * tool_result blocks at the start of the following user message. Legacy
 * conversations (especially interrupted turns) can miss these blocks, causing
 * "Tool result is missing for tool call ..." errors on resume.
 */
export function sanitizeInitialMessagesForSessionStart(messages: unknown[]): unknown[] {
	if (messages.length === 0) {
		return messages
	}

	const sanitized = [...messages]
	let changed = false

	for (let i = 0; i < sanitized.length; i++) {
		const assistantMessage = sanitized[i]
		if (!isRecord(assistantMessage) || assistantMessage.role !== "assistant") {
			continue
		}

		const toolUseIds = getToolUseIds(assistantMessage.content)
		if (toolUseIds.length === 0) {
			continue
		}

		const next = sanitized[i + 1]
		if (!isRecord(next) || next.role !== "user") {
			// Insert a synthetic user message with placeholder tool results so
			// the message stream remains valid for SDK parsing.
			sanitized.splice(i + 1, 0, {
				role: "user",
				content: toolUseIds.map(createMissingToolResult),
			})
			changed = true
			i += 1
			continue
		}

		const originalBlocks = toBlocks(next.content)
		const matchingToolResults = new Map<string, GenericContentBlock>()

		for (const block of originalBlocks) {
			for (const toolUseId of toolUseIds) {
				if (!matchingToolResults.has(toolUseId) && isToolResultForId(block, toolUseId)) {
					matchingToolResults.set(toolUseId, block)
				}
			}
		}

		const missingToolResultIds = toolUseIds.filter((toolUseId) => !matchingToolResults.has(toolUseId))
		const orderedToolResults = toolUseIds.map(
			(toolUseId) => matchingToolResults.get(toolUseId) ?? createMissingToolResult(toolUseId),
		)
		const otherBlocks = originalBlocks.filter((block) => !toolUseIds.some((toolUseId) => isToolResultForId(block, toolUseId)))

		// If we had to synthesize missing tool_result blocks (or are carrying the
		// migration placeholder from a previous resume attempt), keep the immediate
		// response message strictly tool_result-only for maximum provider compatibility.
		// Move any existing non-tool-result content into a follow-up user message.
		const hasMigrationPlaceholder = orderedToolResults.some(isMigrationPlaceholderToolResult)
		if (missingToolResultIds.length > 0 || hasMigrationPlaceholder) {
			sanitized[i + 1] = {
				...next,
				content: orderedToolResults,
			}
			if (otherBlocks.length > 0) {
				sanitized.splice(i + 2, 0, {
					role: "user",
					content: otherBlocks,
				})
				i += 1
			}
			changed = true
			continue
		}

		const newContent = [...orderedToolResults, ...otherBlocks]
		const differsInLength = newContent.length !== originalBlocks.length
		const differsInOrder = !differsInLength && newContent.some((block, index) => block !== originalBlocks[index])
		if (differsInLength || differsInOrder) {
			sanitized[i + 1] = {
				...next,
				content: newContent,
			}
			changed = true
		}
	}

	return changed ? sanitized : messages
}
