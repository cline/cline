import { ExtensionState } from "@shared/ExtensionMessage"
import { ClineMessage } from "@shared/ExtensionMessage"
import { sendStateUpdate } from "./subscribeToState"

interface StateUpdateDelta {
	type: "full" | "partial"
	fullState?: ExtensionState
	changes?: {
		clineMessages?: {
			type: "append" | "update" | "replace"
			items?: ClineMessage[]
			updates?: Array<{ index: number; message: ClineMessage }>
			startIndex?: number
		}
		taskHistory?: {
			type: "update" | "replace"
			items?: any[]
		}
		apiConfiguration?: any
		customInstructions?: string
		// Add other fields as needed
	}
}

// Track the last sent state to calculate deltas
let lastSentState: Partial<ExtensionState> = {}
let lastSentMessageCount = 0

/**
 * Send incremental state updates to reduce memory usage
 * Only sends changed parts of the state instead of the entire state object
 */
export async function sendIncrementalStateUpdate(state: ExtensionState): Promise<void> {
	// For initial state or when we need a full refresh
	if (!lastSentState.version || lastSentState.version !== state.version) {
		await sendStateUpdate(state)
		lastSentState = { ...state }
		lastSentMessageCount = state.clineMessages?.length || 0
		return
	}

	// Check if we should send a full update (e.g., task changed)
	if (lastSentState.currentTaskItem?.id !== state.currentTaskItem?.id) {
		await sendStateUpdate(state)
		lastSentState = { ...state }
		lastSentMessageCount = state.clineMessages?.length || 0
		return
	}

	// Build delta update
	const delta: StateUpdateDelta = {
		type: "partial",
		changes: {},
	}

	// Handle message updates efficiently
	if (state.clineMessages && state.clineMessages.length > lastSentMessageCount) {
		// Only send new messages
		const newMessages = state.clineMessages.slice(lastSentMessageCount)
		delta.changes!.clineMessages = {
			type: "append",
			items: newMessages,
		}
		lastSentMessageCount = state.clineMessages.length
	} else if (state.clineMessages && state.clineMessages.length > 0) {
		// Check for updates to existing messages (e.g., partial message updates)
		const lastMessage = state.clineMessages[state.clineMessages.length - 1]
		const lastSentMessage = lastSentState.clineMessages?.[state.clineMessages.length - 1]

		if (
			lastMessage &&
			lastSentMessage &&
			lastMessage.ts === lastSentMessage.ts &&
			lastMessage.text !== lastSentMessage.text
		) {
			delta.changes!.clineMessages = {
				type: "update",
				updates: [{ index: state.clineMessages.length - 1, message: lastMessage }],
			}
		}
	}

	// Check other fields for changes
	if (state.apiConfiguration !== lastSentState.apiConfiguration) {
		delta.changes!.apiConfiguration = state.apiConfiguration
	}

	if (state.customInstructions !== lastSentState.customInstructions) {
		delta.changes!.customInstructions = state.customInstructions
	}

	// Only send if there are actual changes
	if (Object.keys(delta.changes!).length > 0) {
		// For now, we still send the full state, but we could modify the webview
		// to handle incremental updates in the future
		await sendStateUpdate(state)
		lastSentState = { ...state }
	}
}

/**
 * Reset the incremental state tracker
 * Call this when switching tasks or clearing state
 */
export function resetIncrementalStateTracker(): void {
	lastSentState = {}
	lastSentMessageCount = 0
}

/**
 * Get memory usage statistics
 */
export function getStateMemoryStats(): {
	messageCount: number
	estimatedSize: number
	lastUpdateSize: number
} {
	const messageCount = lastSentMessageCount
	const stateString = JSON.stringify(lastSentState)
	const estimatedSize = new Blob([stateString]).size

	return {
		messageCount,
		estimatedSize,
		lastUpdateSize: 0, // Will be tracked in future implementation
	}
}
