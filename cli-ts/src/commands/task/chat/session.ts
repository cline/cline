/**
 * Chat session state management
 *
 * Defines the session interface and factory function.
 */

import type { CliWebviewAdapter } from "../../../core/cli-webview-adapter.js"

/**
 * Chat session state
 */
export interface ChatSession {
	taskId: string | null
	isRunning: boolean
	awaitingApproval: boolean
	awaitingInput: boolean
	adapter: CliWebviewAdapter | null
	yoloMode: boolean
	yoloFailureCount: number
	yoloLastFailedAction: string | null
	yoloActionStartTime: number | null
	yoloCompleted: boolean
}

/**
 * Create a new chat session with default state
 */
export function createSession(yoloMode = false): ChatSession {
	return {
		taskId: null,
		isRunning: true,
		awaitingApproval: false,
		awaitingInput: false,
		adapter: null,
		yoloMode,
		yoloFailureCount: 0,
		yoloLastFailedAction: null,
		yoloActionStartTime: null,
		yoloCompleted: false,
	}
}
