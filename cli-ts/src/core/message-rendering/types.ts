/**
 * Types and interfaces for message rendering
 *
 * These types define the contract between the CliWebviewAdapter and
 * the various message renderers, enabling modular and testable rendering.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import type { OutputFormatter } from "../output/types.js"

/**
 * Context provided to renderers for outputting messages
 *
 * This allows renderers to access shared resources without
 * creating circular dependencies with the adapter.
 */
export interface RenderContext {
	/** Formatter for outputting to the terminal */
	formatter: OutputFormatter

	/** Get current messages from the controller */
	getMessages: () => ClineMessage[]

	/** Set the current options for numbered selection (used by followup questions) */
	setCurrentOptions: (options: string[]) => void
}

/**
 * Interface for message renderers
 *
 * Each renderer is responsible for a specific category of messages
 * (e.g., say messages, ask messages, tool messages).
 */
export interface MessageRenderer {
	/**
	 * Render a message to the terminal
	 *
	 * @param msg - The ClineMessage to render
	 */
	render(msg: ClineMessage): void
}
