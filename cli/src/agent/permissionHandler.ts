/**
 * Permission handling for ACP integration.
 *
 * This module handles the translation between ACP permission requests/responses
 * and Cline's internal permission system. It maps ClineAsk types to appropriate
 * ACP permission options and translates user responses back to Cline's format.
 *
 * @module acp/permissionHandler
 */

import type * as acp from "@agentclientprotocol/sdk"
import type { ClineAsk } from "@shared/ExtensionMessage"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import { Logger } from "@/shared/services/Logger.js"
import type { AcpSessionState, ClinePermissionOption } from "./types.js"

/**
 * Standard permission options for operations that support "always allow".
 * Used for commands, tools, and MCP server operations.
 */
const STANDARD_PERMISSION_OPTIONS: ClinePermissionOption[] = [
	{ kind: "allow_once", optionId: "allow_once", name: "Allow Once" },
	{ kind: "allow_always", optionId: "allow_always", name: "Always Allow" },
	{ kind: "reject_once", optionId: "reject_once", name: "Reject" },
]

/**
 * Permission options for operations that don't support "always allow".
 * Used for browser actions and other one-time operations.
 */
const RESTRICTED_PERMISSION_OPTIONS: ClinePermissionOption[] = [
	{ kind: "allow_once", optionId: "allow_once", name: "Allow Once" },
	{ kind: "reject_once", optionId: "reject_once", name: "Reject" },
]

/**
 * Mapping of ClineAsk types to their permission option sets.
 */
const ASK_TYPE_PERMISSION_MAP: Partial<Record<ClineAsk, ClinePermissionOption[]>> = {
	// Commands support "always allow" for auto-approval
	command: STANDARD_PERMISSION_OPTIONS,

	// Tool operations support "always allow"
	tool: STANDARD_PERMISSION_OPTIONS,

	// MCP server operations support "always allow"
	use_mcp_server: STANDARD_PERMISSION_OPTIONS,

	// Browser actions are one-time, no "always allow"
	browser_action_launch: RESTRICTED_PERMISSION_OPTIONS,

	// Command output continuation - simple allow/reject
	command_output: RESTRICTED_PERMISSION_OPTIONS,
}

/**
 * ClineAsk types that require permission handling.
 * Other ask types (like followup, plan_mode_respond) don't need permission UI.
 */
const PERMISSION_REQUIRING_ASK_TYPES: Set<ClineAsk> = new Set([
	"command",
	"tool",
	"browser_action_launch",
	"use_mcp_server",
	"command_output",
])

/**
 * Result of handling a permission response.
 */
export interface PermissionHandlerResult {
	/** Cline's internal response type */
	response: ClineAskResponse
	/** Optional text to pass with the response */
	text?: string
	/** Whether "always allow" was selected (for auto-approval tracking) */
	alwaysAllow?: boolean
	/** Whether the request was cancelled */
	cancelled?: boolean
}

/**
 * Check if a ClineAsk type requires permission handling.
 *
 * @param askType - The ClineAsk type to check
 * @returns True if the ask type requires permission UI
 */
export function requiresPermission(askType: ClineAsk): boolean {
	return PERMISSION_REQUIRING_ASK_TYPES.has(askType)
}

/**
 * Get the appropriate permission options for a ClineAsk type.
 *
 * @param askType - The ClineAsk type
 * @returns Array of permission options, or undefined if the ask type doesn't require permission
 */
export function getPermissionOptionsForAskType(askType: ClineAsk): acp.PermissionOption[] | undefined {
	const options = ASK_TYPE_PERMISSION_MAP[askType]
	if (!options) {
		return undefined
	}

	// Convert to ACP PermissionOption format
	return options.map((opt) => ({
		kind: opt.kind,
		optionId: opt.optionId,
		name: opt.name,
	}))
}

/**
 * Handle an ACP permission response and translate it to Cline's format.
 *
 * @param response - The ACP permission response from the client
 * @param askType - The original ClineAsk type that triggered the permission request
 * @returns The translated result for Cline's handleWebviewAskResponse
 */
export function handlePermissionResponse(response: acp.RequestPermissionResponse, askType: ClineAsk): PermissionHandlerResult {
	// Check if cancelled
	if (response.outcome.outcome === "cancelled") {
		return {
			response: "noButtonClicked",
			cancelled: true,
		}
	}

	// Get the selected option ID
	const optionId = response.outcome.optionId

	// Translate the option to Cline's response format
	switch (optionId) {
		case "allow_once":
			return {
				response: "yesButtonClicked",
				alwaysAllow: false,
			}

		case "allow_always":
			return {
				response: "yesButtonClicked",
				alwaysAllow: true,
			}

		case "reject_once":
		case "reject_always":
			return {
				response: "noButtonClicked",
				alwaysAllow: false,
			}

		default:
			// Unknown option ID - treat as rejection for safety
			Logger.error(`[permissionHandler] Unknown permission option: ${optionId}`)
			return {
				response: "noButtonClicked",
			}
	}
}

/**
 * Create a permission request for an ACP tool call.
 *
 * @param toolCall - The ACP tool call that needs permission
 * @param askType - The Cline ask type
 * @returns The permission request options, or null if no permission needed
 */
export function createPermissionRequest(
	toolCall: acp.ToolCall,
	askType: ClineAsk,
): { toolCall: acp.ToolCall; options: acp.PermissionOption[] } | null {
	const options = getPermissionOptionsForAskType(askType)
	if (!options) {
		return null
	}

	return {
		toolCall,
		options,
	}
}

/**
 * Track "always allow" decisions for auto-approval.
 * This maintains a set of tool/command patterns that have been auto-approved.
 */
export class AutoApprovalTracker {
	/** Set of auto-approved command prefixes */
	private autoApprovedCommands: Set<string> = new Set()

	/** Set of auto-approved tool names */
	private autoApprovedTools: Set<string> = new Set()

	/** Set of auto-approved MCP servers */
	private autoApprovedMcpServers: Set<string> = new Set()

	/**
	 * Record an "always allow" decision for a permission request.
	 *
	 * @param askType - The Cline ask type that was auto-approved
	 * @param identifier - The identifier for the operation (command, tool name, etc.)
	 */
	recordAlwaysAllow(askType: ClineAsk, identifier: string): void {
		switch (askType) {
			case "command":
				// Store the first word of the command as the key
				const commandPrefix = identifier.split(" ")[0]
				this.autoApprovedCommands.add(commandPrefix)
				break

			case "tool":
				this.autoApprovedTools.add(identifier)
				break

			case "use_mcp_server":
				this.autoApprovedMcpServers.add(identifier)
				break
		}
	}

	/**
	 * Check if an operation has been auto-approved.
	 *
	 * @param askType - The Cline ask type
	 * @param identifier - The identifier for the operation
	 * @returns True if the operation was previously auto-approved
	 */
	isAutoApproved(askType: ClineAsk, identifier: string): boolean {
		switch (askType) {
			case "command":
				const commandPrefix = identifier.split(" ")[0]
				return this.autoApprovedCommands.has(commandPrefix)

			case "tool":
				return this.autoApprovedTools.has(identifier)

			case "use_mcp_server":
				return this.autoApprovedMcpServers.has(identifier)

			default:
				return false
		}
	}

	/**
	 * Clear all auto-approval records.
	 */
	clear(): void {
		this.autoApprovedCommands.clear()
		this.autoApprovedTools.clear()
		this.autoApprovedMcpServers.clear()
	}
}

/**
 * Process a pending permission request for a session.
 *
 * This function coordinates the permission flow:
 * 1. Checks if the operation is already auto-approved
 * 2. If not, requests permission from the ACP client
 * 3. Tracks "always allow" decisions
 * 4. Returns the translated result for Cline
 *
 * @param requestPermission - Function to request permission from the ACP client
 * @param sessionId - The session ID
 * @param toolCall - The tool call requiring permission
 * @param askType - The Cline ask type
 * @param identifier - Identifier for auto-approval tracking
 * @param autoApprovalTracker - The auto-approval tracker
 * @returns The permission handler result
 */
export async function processPermissionRequest(
	requestPermission: (
		sessionId: string,
		toolCall: acp.ToolCall,
		options: acp.PermissionOption[],
	) => Promise<acp.RequestPermissionResponse>,
	sessionId: string,
	toolCall: acp.ToolCall,
	askType: ClineAsk,
	identifier: string,
	autoApprovalTracker?: AutoApprovalTracker,
): Promise<PermissionHandlerResult> {
	// Check if already auto-approved
	if (autoApprovalTracker?.isAutoApproved(askType, identifier)) {
		return {
			response: "yesButtonClicked",
			alwaysAllow: true,
		}
	}

	// Get permission options for this ask type
	const options = getPermissionOptionsForAskType(askType)
	if (!options) {
		// No permission options defined - allow by default
		return {
			response: "yesButtonClicked",
		}
	}

	// Request permission from the ACP client
	const response = await requestPermission(sessionId, toolCall, options)

	// Handle the response
	const result = handlePermissionResponse(response, askType)

	// Track "always allow" decisions
	if (result.alwaysAllow && autoApprovalTracker) {
		autoApprovalTracker.recordAlwaysAllow(askType, identifier)
	}

	return result
}

/**
 * Get the identifier for auto-approval tracking from a tool call.
 *
 * @param toolCall - The ACP tool call
 * @param askType - The Cline ask type
 * @returns The identifier string for auto-approval tracking
 */
export function getAutoApprovalIdentifier(toolCall: acp.ToolCall, askType: ClineAsk): string {
	const rawInput = toolCall.rawInput as Record<string, unknown> | undefined

	switch (askType) {
		case "command":
			return (rawInput?.command as string) || toolCall.title

		case "tool":
			// Try to get tool name from raw input or title
			return (rawInput?.tool as string) || toolCall.title

		case "use_mcp_server":
			return (rawInput?.serverName as string) || toolCall.title

		default:
			return toolCall.toolCallId
	}
}

/**
 * Update the session state's pending tool call after permission is handled.
 *
 * @param sessionState - The session state to update
 * @param toolCallId - The tool call ID that was handled
 * @param approved - Whether the permission was approved
 */
export function updateSessionStateAfterPermission(sessionState: AcpSessionState, toolCallId: string, approved: boolean): void {
	// Remove from pending tool calls
	sessionState.pendingToolCalls.delete(toolCallId)

	// Clear current tool call ID if it matches
	if (sessionState.currentToolCallId === toolCallId && !approved) {
		sessionState.currentToolCallId = undefined
	}
}
