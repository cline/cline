import { useMemo } from "react"
import { ClineMessage } from "@shared/ExtensionMessage"

/**
 * Custom hook to determine the dynamic styles for a ChatRowContainer.
 *
 * This hook calculates the padding and minimum height for a chat row based on
 * whether it represents a checkpoint message and its current hover state.
 * The goal is to visually collapse checkpoint markers when they are not checked out
 * and not being hovered over, while ensuring they remain interactable.
 *
 * @param message - The chat message object for the current row.
 * @param hoveredRowIndex - The index of the currently hovered row, or null if none.
 * @param rowIndex - The index of the current row being rendered.
 * @returns An object containing the calculated style properties (padding and minHeight).
 */
export const useChatRowStyles = (
	message: ClineMessage,
	hoveredRowIndex: number | null,
	rowIndex: number,
): { padding: number | undefined; minHeight: number | undefined } => {
	return useMemo(() => {
		// Check if the current message is a checkpoint creation message.
		const isCheckpointMessage = message.say === "checkpoint_created"

		// Determine if the hover state is relevant to this row or the one immediately preceding it.
		// This is because the checkpoint marker is visually associated with the row *before* the checkpoint message,
		// but its visibility is controlled by the hover state of *both* the preceding row and the checkpoint message row itself.
		const isHoverRelevant = hoveredRowIndex === rowIndex - 1 || hoveredRowIndex === rowIndex

		// Calculate styles based on checkpoint status and hover relevance.
		// If it's a checkpoint message, not currently checked out, and not relevantly hovered,
		// reset padding to 0 and set minHeight to 1px to visually collapse it.
		// Otherwise, use default styles (undefined, letting CSS handle it).
		const padding = isCheckpointMessage && !message.isCheckpointCheckedOut && !isHoverRelevant ? 0 : undefined
		const minHeight = isCheckpointMessage && !message.isCheckpointCheckedOut && !isHoverRelevant ? 1 : undefined

		return { padding, minHeight }
	}, [message.say, message.isCheckpointCheckedOut, hoveredRowIndex, rowIndex])
}
