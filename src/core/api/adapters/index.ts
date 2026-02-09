import { BeadsmithStorageMessage } from "@/shared/messages/content"
import { BeadsmithDefaultTool } from "@/shared/tools"
import { convertApplyPatchToolCalls, convertWriteToFileToolCalls } from "./diff-editors"

/**
 * Transforms tool call messages between different tool formats based on native tool support.
 * Converts between apply_patch and write_to_file/replace_in_file formats as needed.
 *
 * @param beadsmithMessages - Array of messages containing tool calls to transform
 * @param nativeTools - Array of tools natively supported by the current provider
 * @returns Transformed messages array, or original if no transformation needed
 */
export function transformToolCallMessages(
	beadsmithMessages: BeadsmithStorageMessage[],
	nativeTools?: BeadsmithDefaultTool[],
): BeadsmithStorageMessage[] {
	// Early return if no messages or native tools provided
	if (!beadsmithMessages?.length || !nativeTools?.length) {
		return beadsmithMessages
	}

	// Create Sets for O(1) lookup performance
	const nativeToolSet = new Set(nativeTools)
	const usedToolSet = new Set<string>()

	// Single pass: collect all tools used in assistant messages
	for (const msg of beadsmithMessages) {
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
		return beadsmithMessages
	}

	// Determine which conversion to apply
	const hasApplyPatchNative = nativeToolSet.has(BeadsmithDefaultTool.APPLY_PATCH)
	const hasFileEditNative =
		nativeToolSet.has(BeadsmithDefaultTool.FILE_EDIT) || nativeToolSet.has(BeadsmithDefaultTool.FILE_NEW)

	const hasApplyPatchUsed = usedToolSet.has(BeadsmithDefaultTool.APPLY_PATCH)
	const hasFileEditUsed = usedToolSet.has(BeadsmithDefaultTool.FILE_EDIT) || usedToolSet.has(BeadsmithDefaultTool.FILE_NEW)

	// Convert write_to_file/replace_in_file → apply_patch
	if (hasApplyPatchNative && hasFileEditUsed) {
		return convertWriteToFileToolCalls(beadsmithMessages)
	}

	// Convert apply_patch → write_to_file/replace_in_file
	if (hasFileEditNative && hasApplyPatchUsed) {
		return convertApplyPatchToolCalls(beadsmithMessages)
	}

	return beadsmithMessages
}
