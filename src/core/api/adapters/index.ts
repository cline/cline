import { ClineStorageMessage } from "@/shared/messages/content"
import { ClineDefaultTool } from "@/shared/tools"
import { convertApplyPatchToolCalls, convertWriteToFileToolCalls } from "./diff-editors"

/**
 * Transforms tool call messages between different tool formats based on native tool support.
 * Converts between apply_patch and write_to_file/replace_in_file formats as needed.
 *
 * @param clineMessages - Array of messages containing tool calls to transform
 * @param nativeTools - Array of tools natively supported by the current provider
 * @returns Transformed messages array, or original if no transformation needed
 */
export function transformToolCallMessages(
	clineMessages: ClineStorageMessage[],
	nativeTools?: ClineDefaultTool[],
): ClineStorageMessage[] {
	// Early return if no messages or native tools provided
	if (!clineMessages?.length || !nativeTools?.length) {
		return clineMessages
	}

	// Create Sets for O(1) lookup performance
	const nativeToolSet = new Set(nativeTools)
	const usedToolSet = new Set<string>()

	// Single pass: collect all tools used in assistant messages
	for (const msg of clineMessages) {
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_use" && block.name) {
					usedToolSet.add(block.name)
				}
			}
		}
	}

	// Early return if no tools were used
	if (usedToolSet.size === 0) {
		return clineMessages
	}

	// Determine which conversion to apply
	const hasApplyPatchNative = nativeToolSet.has(ClineDefaultTool.APPLY_PATCH)
	const hasFileEditNative = nativeToolSet.has(ClineDefaultTool.FILE_EDIT) || nativeToolSet.has(ClineDefaultTool.FILE_NEW)

	const hasApplyPatchUsed = usedToolSet.has(ClineDefaultTool.APPLY_PATCH)
	const hasFileEditUsed = usedToolSet.has(ClineDefaultTool.FILE_EDIT) || usedToolSet.has(ClineDefaultTool.FILE_NEW)

	// Convert write_to_file/replace_in_file → apply_patch
	if (hasApplyPatchNative && hasFileEditUsed) {
		return convertWriteToFileToolCalls(clineMessages)
	}

	// Convert apply_patch → write_to_file/replace_in_file
	if (hasFileEditNative && hasApplyPatchUsed) {
		return convertApplyPatchToolCalls(clineMessages)
	}

	return clineMessages
}
