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

type HookStatusSay = "hook" | "hook_status"
type HookOutputStreamSay = "hook_output" | "hook_output_stream"

function getSay(msg: ClineMessage): string | undefined {
	// Back-compat: older recordings may be deserialized without strict typing.
	return msg.say as string | undefined
}

function isHookStatusSay(say: string | undefined): say is HookStatusSay {
	return say === "hook_status" || say === "hook"
}

function isHookOutputStreamSay(say: string | undefined): say is HookOutputStreamSay {
	return say === "hook_output_stream" || say === "hook_output"
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
	if (!isHookStatusSay(getSay(hookMessage)) || !hookMessage.text) {
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

	// Collect all hook_output_stream messages until we hit another hook_status/hook or end of array
	while (i < messages.length && !isHookStatusSay(getSay(messages[i]))) {
		const say = getSay(messages[i])
		if (isHookOutputStreamSay(say)) {
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
		if (isHookStatusSay(getSay(messages[i]))) {
			const { combined, nextIndex } = combineHookWithOutputs(messages[i], i, messages)
			combinedHooksByTs.set(combined.ts, combined)
			i = nextIndex - 1 // Adjust for loop increment
		}
	}

	// Pass 2: Build result array
	const result: ClineMessage[] = []

	for (const msg of messages) {
		const say = getSay(msg)
		if (isHookOutputStreamSay(say)) {
		} else if (isHookStatusSay(say)) {
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
 * Finds the timestamp of the immediate next tool/command after a given hook.
 *
 * This function ensures stable hook-to-tool associations by only matching a hook
 * with the IMMEDIATE next tool (no other hooks or tools in between). This prevents
 * hooks from being remapped to different tools when new tools are added later.
 *
 * @param hookIndex The starting index to search from
 * @param messages The original messages array (may include partial tools)
 * @returns The timestamp of the immediate next tool, or null if none found
 */
function findImmediateNextToolTimestamp(hookIndex: number, messages: ClineMessage[]): number | null {
	for (let i = hookIndex + 1; i < messages.length; i++) {
		const msg = messages[i]

		// If we hit a tool, this is the immediate next tool
		if (isToolOrCommandMessage(msg)) {
			return msg.ts
		}

		// If we hit another PreToolUse hook before finding a tool, stop searching
		// This prevents matching a hook to a tool that has its own PreToolUse hook
		if (isHookStatusSay(getSay(msg))) {
			const metadata = parseHookMetadata(msg)
			if (metadata?.hookName === "PreToolUse") {
				return null
			}
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
 * A PreToolUse hook should only be mapped to a tool if the hook was created AFTER the
 * tool already exists in the message stream. This can happen when hooks arrive late
 * or out of order. If the hook timestamp < tool timestamp, it means the hook
 * naturally appears before the tool chronologically and should NOT be moved.
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

		// Find the immediate next tool after this hook in the original array
		const toolTimestamp = findImmediateNextToolTimestamp(hookIndexInOriginal, originalMessages)
		if (toolTimestamp === null) {
			// No tool found - hook will stay in original position
			continue
		}

		// CRITICAL FIX: Only map this hook to the tool if it needs to be moved.
		// A hook only needs moving if its timestamp > tool timestamp (arrived after tool).
		// If hook timestamp < tool timestamp, the hook naturally appears before the tool
		// chronologically and should NOT be moved.
		if (msg.ts > toolTimestamp) {
			// Hook arrived after tool - needs to be moved before the tool
			if (!map.has(toolTimestamp)) {
				map.set(toolTimestamp, [])
			}
			map.get(toolTimestamp)!.push(msg)
		}
		// Otherwise, hook is already in correct chronological position - don't move it
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
