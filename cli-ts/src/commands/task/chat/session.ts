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
}

/**
 * Create a new chat session with default state
 */
export function createSession(): ChatSession {
	return {
		taskId: null,
		isRunning: true,
		awaitingApproval: false,
		awaitingInput: false,
		adapter: null,
	}
}
