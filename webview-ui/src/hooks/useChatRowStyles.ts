import { CSSProperties, useMemo } from "react"
import { ClineMessage } from "@shared/ExtensionMessage"

/**
 * Custom hook to determine the dynamic styles for a ChatRowContainer.
 *
 * This hook provides styles for checkpoint messages that control their
 * visual appearance based on hover state and whether they're checked out.
 *
 * @param message - The chat message object for the current row.
 * @returns An object containing the calculated style properties.
 */
export const useChatRowStyles = (message: ClineMessage): CSSProperties => {
	return useMemo(() => {
		// Check if the current message is a checkpoint creation message.
		const isCheckpointMessage = message.say === "checkpoint_created"

		// For checkpoint messages, make the row take up minimal space
		// The checkpoint component will be absolutely positioned
		if (isCheckpointMessage) {
			return {
				padding: 0,
				// we can't set height to 0 because virtuoso needs a height to render the row, we can't set to 1 because it results in a visual artifact bug, so we use this hack to make the row almost invisible (and the checkpoint indicator positioned absolutely at this point in the list)
				height: 8,
				marginTop: -4,
				marginBottom: -4,
				overflow: "visible", // Allow the absolutely positioned content to be visible
			}
		}

		// For non-checkpoint messages, return normal styling
		return {
			padding: undefined,
			minHeight: undefined,
			height: undefined,
			overflow: undefined,
			position: undefined,
		}
	}, [message.say])
}
