/**
 * Types for state subscription management
 */

import type { ClineMessage } from "@shared/ExtensionMessage"

/**
 * Callback type for state change notifications
 */
export type StateChangeHandler = (messages: ClineMessage[]) => void

/**
 * Callback type for individual message handling
 */
export type MessageCallback = (msg: ClineMessage) => void

/**
 * Configuration for the state subscriber
 */
export interface StateSubscriberConfig {
	/** Callback when state changes */
	onStateChange?: StateChangeHandler

	/** Callback for complete (non-partial) messages to output */
	onCompleteMessage: MessageCallback

	/** Function to get current messages from the controller */
	getMessages: () => ClineMessage[]

	/** Callback for activity (used by spinner) */
	onActivity?: () => void
}
