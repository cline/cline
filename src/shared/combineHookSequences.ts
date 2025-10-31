import { ClineMessage } from "./ExtensionMessage"

/**
 * Hook metadata extracted from hook message text.
 * Mirrors the ClineSayHook interface but represents parsed data.
 */
interface HookMetadata {
	hookName: string
	toolName?: string
	status: string
	exitCode?: number
	hasJsonResponse?: boolean
}

// ============================================================================
// PART 1: TYPE GUARDS & UTILITIES
// ============================================================================

/**
 * Type guard to check if a message is a tool or command.
 */
function isToolOrCommandMessage(msg: ClineMessage): boolean {
	return msg.ask === "tool" || msg.say === "tool" || msg.ask === "command" || msg.say === "command"
}

/**
 * Safely parses hook metadata from a hook message.
 * Returns null if parsing fails or message is not a hook.
 */
function parseHookMetadata(hookMessage: ClineMessage): HookMetadata | null {
	if (hookMessage.say !== "hook" || !hookMessage.text) {
		return null
	}

	try {
		const outputIndex = hookMessage.text.indexOf(HOOK_OUTPUT_STRING)
		const metadataStr = outputIndex !== -1 ? hookMessage.text.slice(0, outputIndex).trim() : hookMessage.text.trim()

		return JSON.parse(metadataStr) as HookMetadata
	} catch {
		return null
	}
}

// ============================================================================
// PART 2: FILTERING & COMBINING
// ============================================================================

/**
 * Filters out partial tool/command messages while preserving all other types.
 * Reasoning messages are always kept, even if marked partial.
 *
 * This prevents duplicate messages during React render cycles where partial
 * messages are removed and replaced with complete versions.
 */
function filterPartialToolMessages(messages: ClineMessage[]): ClineMessage[] {
	return messages.filter((msg) => {
		// Always keep reasoning messages
		if (msg.say === "reasoning") {
			return true
		}

		// Filter out partial tool/command messages only
		const isToolOrCommand = isToolOrCommandMessage(msg)
		return !(isToolOrCommand && msg.partial === true)
	})
}

/**
 * Combines a single hook message with all subsequent hook_output messages.
 *
 * @param hookMessage The hook message to start combining from
 * @param startIndex The index of the hook message in the messages array
 * @param messages The full messages array
 * @returns Object containing the combined message and the next index to process
 */
function combineHookWithOutputs(
	hookMessage: ClineMessage,
	startIndex: number,
	messages: ClineMessage[],
): { combined: ClineMessage; nextIndex: number } {
	let combinedText = hookMessage.text || ""
	let hasOutput = false
	let i = startIndex + 1

	// Collect all hook_output messages until we hit another hook or end of array
	while (i < messages.length && messages[i].say !== "hook") {
		if (messages[i].say === "hook_output") {
			// Add marker before first output
			if (!hasOutput) {
				combinedText += `\n${HOOK_OUTPUT_STRING}`
				hasOutput = true
			}

			// Append output if not empty
			const output = messages[i].text || ""
			if (output.length > 0) {
				combinedText += "\n" + output
			}
		}
		i++
	}

	return {
		combined: { ...hookMessage, text: combinedText },
		nextIndex: i,
	}
}

/**
 * Combines all hooks with their outputs and removes hook_output messages.
 *
 * This is a two-pass process:
 * 1. Scan through and combine each hook with its outputs
 * 2. Build final array without hook_output messages, using combined hooks
 */
function combineAllHooks(messages: ClineMessage[]): ClineMessage[] {
	// Pass 1: Build map of combined hooks by timestamp
	const combinedHooksByTs = new Map<number, ClineMessage>()

	for (let i = 0; i < messages.length; i++) {
		if (messages[i].say === "hook") {
			const { combined, nextIndex } = combineHookWithOutputs(messages[i], i, messages)
			combinedHooksByTs.set(combined.ts, combined)
			i = nextIndex - 1 // Adjust for loop increment
		}
	}

	// Pass 2: Build result array
	const result: ClineMessage[] = []

	for (const msg of messages) {
		if (msg.say === "hook_output") {
		} else if (msg.say === "hook") {
			// Use combined version
			result.push(combinedHooksByTs.get(msg.ts) || msg)
		} else {
			// Keep all other messages as-is
			result.push(msg)
		}
	}

	return result
}

// ============================================================================
// PART 3: PRETOOLUSE REORDERING
// ============================================================================

/**
 * Finds the timestamp of the next tool/command after a given index.
 *
 * Searches in the original messages array (not filtered) to catch tools
 * that might still be partial. This ensures PreToolUse hooks are matched
 * immediately even if their tool hasn't fully arrived yet.
 *
 * @param hookIndex The starting index to search from
 * @param messages The original messages array (may include partial tools)
 * @returns The timestamp of the next tool, or null if none found
 */
function findNextToolTimestamp(hookIndex: number, messages: ClineMessage[]): number | null {
	for (let i = hookIndex + 1; i < messages.length; i++) {
		if (isToolOrCommandMessage(messages[i])) {
			return messages[i].ts
		}
	}
	return null
}

/**
 * Builds a map of tool timestamps to their PreToolUse hooks.
 *
 * This map indicates which hooks should be moved to appear before which tools.
 * Only PreToolUse hooks are included; PostToolUse hooks stay in their original position.
 *
 * @param processedMessages Messages after filtering and combining
 * @param originalMessages Original messages array (used to find tools)
 * @returns Map of tool timestamp -> array of PreToolUse hooks for that tool
 */
function buildPreToolUseMap(processedMessages: ClineMessage[], originalMessages: ClineMessage[]): Map<number, ClineMessage[]> {
	const map = new Map<number, ClineMessage[]>()

	// Build timestamp-to-index map once to avoid O(n) findIndex calls
	const timestampToIndex = new Map<number, number>()
	for (let i = 0; i < originalMessages.length; i++) {
		timestampToIndex.set(originalMessages[i].ts, i)
	}

	for (const msg of processedMessages) {
		// Only process PreToolUse hooks
		const metadata = parseHookMetadata(msg)
		if (metadata?.hookName !== "PreToolUse") {
			continue
		}

		// Find this hook's position in the original array using the index map
		const hookIndexInOriginal = timestampToIndex.get(msg.ts)
		if (hookIndexInOriginal === undefined) {
			continue // Shouldn't happen, but be safe
		}

		// Find the next tool after this hook in the original array
		const toolTimestamp = findNextToolTimestamp(hookIndexInOriginal, originalMessages)
		if (toolTimestamp === null) {
			// No tool found - hook will stay in original position
			continue
		}

		// Map this hook to appear before that tool
		if (!map.has(toolTimestamp)) {
			map.set(toolTimestamp, [])
		}
		map.get(toolTimestamp)!.push(msg)
	}

	return map
}

/**
 * Reorders messages so PreToolUse hooks appear before their associated tools.
 *
 * Algorithm:
 * 1. When we encounter a tool, check if it has PreToolUse hooks mapped to it
 * 2. If yes, insert those hooks BEFORE the tool
 * 3. Track which hooks and tools we've already added to avoid duplicates
 * 4. For PreToolUse hooks encountered in their original position:
 *    - If their tool is available and we'll process them before it, skip them
 *    - Otherwise, add them in their current position (tool not available yet)
 *
 * @param messages Messages after filtering and combining
 * @param preToolUseMap Map of tool timestamp -> PreToolUse hooks
 * @returns Reordered messages array
 */
function reorderWithPreToolUseHooks(messages: ClineMessage[], preToolUseMap: Map<number, ClineMessage[]>): ClineMessage[] {
	const result: ClineMessage[] = []
	const addedHooks = new Set<number>()
	const addedTools = new Set<number>()

	// Build set of available tool timestamps for quick lookup
	const availableTools = new Set<number>()
	for (const msg of messages) {
		if (isToolOrCommandMessage(msg)) {
			availableTools.add(msg.ts)
		}
	}

	for (const msg of messages) {
		// Case 1: This is a tool with PreToolUse hooks
		if (isToolOrCommandMessage(msg) && preToolUseMap.has(msg.ts)) {
			const hooksForTool = preToolUseMap.get(msg.ts)!

			// Insert hooks that haven't been added yet
			const newHooks = hooksForTool.filter((h) => !addedHooks.has(h.ts))
			result.push(...newHooks)
			newHooks.forEach((h) => addedHooks.add(h.ts))

			// Add the tool
			result.push(msg)
			addedTools.add(msg.ts)
			continue
		}

		// Case 2: This tool was already added with its hooks
		if (addedTools.has(msg.ts)) {
			continue
		}

		// Case 3: This is a PreToolUse hook in its original position
		const metadata = parseHookMetadata(msg)
		if (metadata?.hookName === "PreToolUse") {
			// Find which tool (if any) this hook is mapped to
			let mappedToolTs: number | undefined
			for (const [toolTs, hooks] of preToolUseMap) {
				if (hooks.some((h) => h.ts === msg.ts)) {
					mappedToolTs = toolTs
					break
				}
			}

			// If this hook's tool is available and we'll insert it before that tool, skip it here
			if (mappedToolTs !== undefined && availableTools.has(mappedToolTs)) {
				continue
			}

			// Otherwise, keep hook in original position (tool not available yet)
		}

		// Case 4: All other messages (text, PostToolUse hooks, reasoning, etc.)
		result.push(msg)
	}

	return result
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Combines sequences of hook and hook_output messages, and reorders
 * PreToolUse hooks to appear before their associated tool messages.
 *
 * Process:
 * 1. Filter out partial tool/command messages (React render cycle cleanup)
 * 2. Combine hooks with their hook_output messages
 * 3. Build mapping of tools to their PreToolUse hooks
 * 4. Reorder so PreToolUse hooks appear before their tools
 *
 * @param messages Array of ClineMessage objects to process
 * @returns New array with hooks combined and PreToolUse hooks reordered
 */
export function combineHookSequences(messages: ClineMessage[]): ClineMessage[] {
	// Phase 1: Filter out partial tool/command messages
	const filtered = filterPartialToolMessages(messages)

	// Phase 2: Combine hooks with their outputs
	const combined = combineAllHooks(filtered)

	// Phase 3: Build PreToolUse hook mapping
	const preToolUseMap = buildPreToolUseMap(combined, messages)

	// Phase 4: Reorder to place PreToolUse hooks before tools
	const reordered = reorderWithPreToolUseHooks(combined, preToolUseMap)

	return reordered
}

export const HOOK_OUTPUT_STRING = "__HOOK_OUTPUT__"
