/**
 * ACP (Agent Client Protocol) integration for Cline CLI.
 *
 * This module provides ACP-compliant agent functionality, allowing Cline
 * to be used as a subprocess agent by editors like Zed, JetBrains, etc.
 *
 * @module acp
 */

// Export the ACP Agent implementation
export { AcpAgent } from "./AcpAgent.js"

// Export the Terminal Manager (terminal operations delegation)
export {
	AcpTerminalManager,
	type CreateTerminalOptions,
	type ManagedTerminal,
	type TerminalEnvVariable,
	type TerminalExitStatus,
	type TerminalOperationResult,
	type TerminalOutputResult,
	type TerminalWaitResult,
} from "./AcpTerminalManager.js"

// Export the message translator
export { createSessionState, translateMessage, translateMessages } from "./messageTranslator.js"

// Export the permission handler
export {
	AutoApprovalTracker,
	createPermissionRequest,
	getAutoApprovalIdentifier,
	getPermissionOptionsForAskType,
	handlePermissionResponse,
	type PermissionHandlerResult,
	processPermissionRequest,
	requiresPermission,
	updateSessionStateAfterPermission,
} from "./permissionHandler.js"
// Export the ACP mode entry point
export { type AcpModeOptions, restoreConsole, runAcpMode } from "./runAcpMode.js"
// Re-export types
export * from "./types.js"
