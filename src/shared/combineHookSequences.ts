import { ClineMessage } from "./ExtensionMessage"

/**
 * Combines sequences of hook and hook_output messages in an array of ClineMessages,
 * and reorders PreToolUse hooks to appear before their associated tool messages.
 *
 * This function:
 * 1. Combines 'hook' messages with their following 'hook_output' messages
 * 2. Reorders PreToolUse hooks to appear BEFORE their associated tool messages
 * 3. Keeps PostToolUse hooks AFTER their associated tool messages
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns A new array of ClineMessage objects with hook sequences combined and reordered.
 */
export function combineHookSequences(messages: ClineMessage[]): ClineMessage[] {
	// Filter out partial tool/command messages to prevent duplicates during React render cycles
	// (partial messages are removed and replaced with complete versions, but may briefly coexist)
	// IMPORTANT: Only filter tool/command messages, NOT reasoning or other message types
	const filteredMessages = messages.filter((msg) => {
		// NEVER filter reasoning messages, even if they have partial: true
		if (msg.say === "reasoning") {
			return true // Always keep reasoning messages
		}

		// Only check tool and command messages for partial filtering
		const isToolMessage = msg.ask === "tool" || msg.say === "tool"
		const isCommandMessage = msg.ask === "command" || msg.say === "command"
		const isToolOrCommand = isToolMessage || isCommandMessage

		// Keep all messages EXCEPT partial tool/command messages
		// This preserves: reasoning (explicitly checked above), text, hooks, and complete tool/command messages
		if (isToolOrCommand && msg.partial === true) {
			return false // Filter out partial tool/command messages
		}
		return true // Keep everything else
	})

	const combinedHooks: ClineMessage[] = []

	// First pass: combine hooks with their outputs (using filtered messages)
	for (let i = 0; i < filteredMessages.length; i++) {
		if (filteredMessages[i].say === "hook") {
			let combinedText = filteredMessages[i].text || ""
			let didAddOutput = false
			let j = i + 1

			while (j < filteredMessages.length) {
				if (filteredMessages[j].say === "hook") {
					// Stop if we encounter the next hook
					break
				}
				if (filteredMessages[j].say === "hook_output") {
					if (!didAddOutput) {
						// Add a marker before the first output
						combinedText += `\n${HOOK_OUTPUT_STRING}`
						didAddOutput = true
					}
					// Handle cases where we receive empty hook_output
					const output = filteredMessages[j].text || ""
					if (output.length > 0) {
						combinedText += "\n" + output
					}
				}
				j++
			}

			combinedHooks.push({
				...filteredMessages[i],
				text: combinedText,
			})

			i = j - 1 // Move to the index just before the next hook or end of array
		}
	}

	// Second pass: remove hook_outputs and replace original hooks with combined ones (using filtered messages)
	const processedMessages = filteredMessages
		.filter((msg) => msg.say !== "hook_output")
		.map((msg) => {
			if (msg.say === "hook") {
				const combinedHook = combinedHooks.find((hook) => hook.ts === msg.ts)
				return combinedHook || msg
			}
			return msg
		})

	// Third pass: reorder PreToolUse hooks to appear before their associated tool/command messages
	// Build a map of tool timestamps to their PreToolUse hooks
	const preToolUseHooksByNextTool = new Map<number, ClineMessage[]>()

	// First scan: identify PreToolUse hooks and map them to the next tool/command
	// IMPORTANT: We look for tools in the ORIGINAL messages array to match hooks immediately,
	// even if the tool is still partial. This prevents delays in showing hooks.
	for (let i = 0; i < processedMessages.length; i++) {
		const msg = processedMessages[i]

		if (msg.say === "hook") {
			try {
				const outputIndex = msg.text?.indexOf(HOOK_OUTPUT_STRING) ?? -1
				const metadataStr = outputIndex !== -1 ? msg.text?.slice(0, outputIndex).trim() : msg.text?.trim()
				const metadata = JSON.parse(metadataStr || "{}")

				if (metadata.hookName === "PreToolUse") {
					// Find the corresponding tool in the ORIGINAL messages array (not filtered)
					// Look backwards from the hook's position in the original array
					const hookIndexInOriginal = messages.findIndex((m) => m.ts === msg.ts)

					for (let j = hookIndexInOriginal - 1; j >= 0; j--) {
						const prevMsg = messages[j]
						const isToolOrCommand =
							prevMsg.ask === "tool" ||
							prevMsg.say === "tool" ||
							prevMsg.ask === "command" ||
							prevMsg.say === "command"

						if (isToolOrCommand) {
							// Map this hook to appear before this tool
							// Use the tool's timestamp even if it's still partial
							if (!preToolUseHooksByNextTool.has(prevMsg.ts)) {
								preToolUseHooksByNextTool.set(prevMsg.ts, [])
							}
							preToolUseHooksByNextTool.get(prevMsg.ts)!.push(msg)
							break
						}
					}
				}
			} catch (e) {
				// If parsing fails, continue
			}
		}
	}

	// Second scan: build the reordered array
	const reorderedMessages: ClineMessage[] = []
	const processedHookTimestamps = new Set<number>()
	const processedToolTimestamps = new Set<number>()

	// Find which tool timestamps actually exist in processedMessages
	const availableToolTimestamps = new Set<number>()
	for (const msg of processedMessages) {
		const isToolOrCommand = msg.ask === "tool" || msg.say === "tool" || msg.ask === "command" || msg.say === "command"
		if (isToolOrCommand) {
			availableToolTimestamps.add(msg.ts)
		}
	}

	for (const msg of processedMessages) {
		// Check if this tool/command has PreToolUse hooks that should appear before it
		const hooksForThisTool = preToolUseHooksByNextTool.get(msg.ts)
		if (hooksForThisTool && hooksForThisTool.length > 0) {
			// Only insert hooks that haven't been added yet
			const hooksToAdd = hooksForThisTool.filter((hook) => !processedHookTimestamps.has(hook.ts))

			if (hooksToAdd.length > 0) {
				// Insert hooks before the tool
				reorderedMessages.push(...hooksToAdd)
				// Mark these hooks as processed
				hooksToAdd.forEach((hook) => processedHookTimestamps.add(hook.ts))
			}

			// Mark this tool as having been processed
			processedToolTimestamps.add(msg.ts)
			// Add the tool immediately after its hooks
			reorderedMessages.push(msg)
			continue // Skip the default add at the end
		}

		// Check if this tool was already added with its hooks
		if (processedToolTimestamps.has(msg.ts)) {
			// Skip this tool, it's already been added with its PreToolUse hooks
			continue
		}

		// Check if this is a PreToolUse hook that will be moved before its tool
		if (msg.say === "hook") {
			try {
				const outputIndex = msg.text?.indexOf(HOOK_OUTPUT_STRING) ?? -1
				const metadataStr = outputIndex !== -1 ? msg.text?.slice(0, outputIndex).trim() : msg.text?.trim()
				const metadata = JSON.parse(metadataStr || "{}")

				if (metadata.hookName === "PreToolUse") {
					// Find which tool (if any) this hook is mapped to
					let matchedToolTimestamp: number | undefined
					for (const [toolTs, hooks] of preToolUseHooksByNextTool.entries()) {
						if (hooks.some((h) => h.ts === msg.ts)) {
							matchedToolTimestamp = toolTs
							break
						}
					}

					// Only skip this hook if its tool is present AND we'll process it before the tool
					if (matchedToolTimestamp !== undefined && availableToolTimestamps.has(matchedToolTimestamp)) {
						// Skip - already inserted before its tool
						continue
					}
					// Otherwise fall through to add in normal position
				}
			} catch (e) {
				// If parsing fails, fall through to normal processing
			}
		}

		// Add the message in its normal position
		// This includes: PreToolUse hooks whose tools aren't available yet, PostToolUse hooks, reasoning, text, etc.
		reorderedMessages.push(msg)
	}

	return reorderedMessages
}

export const HOOK_OUTPUT_STRING = "__HOOK_OUTPUT__"
