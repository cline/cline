/**
 * Chat command module
 *
 * Re-exports the main command factory for backward compatibility.
 */

export { createTaskChatCommand } from "./command.js"

// Also export utilities for testing
export { checkForPendingInput, isCompletionState, isFailureState, type PendingInputState } from "./input-checker.js"
export { getModelIdForProvider, getModelIdKey } from "./model-utils.js"
export { buildPromptString } from "./prompt.js"
export { type ChatSession, createSession } from "./session.js"
