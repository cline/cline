/**
 * Individual message row component
 * Renders a single ClineMessage based on its type
 */

import type { ClineMessage } from "@shared/ExtensionMessage"

/**
 * Get emoji icon for message type
 */
export function getCliMessagePrefixIcon(message: ClineMessage): string {
	if (message.type === "ask") {
		switch (message.ask) {
			case "followup":
				return "❓"
			case "command":
			case "command_output":
				return "⚙️"
			case "tool":
				return "🔧"
			case "completion_result":
				return "✅"
			case "api_req_failed":
				return "❌"
			case "resume_task":
			case "resume_completed_task":
				return "▶️"
			case "browser_action_launch":
				return "🌐"
			case "use_mcp_server":
				return "🔌"
			case "plan_mode_respond":
				return "📋"
			default:
				return "❔"
		}
	} else {
		switch (message.say) {
			case "task":
				return "📋"
			case "error":
				return "❌"
			case "text":
				return "💬"
			case "reasoning":
				return "🧠"
			case "completion_result":
				return "✅"
			case "user_feedback":
				return "👤"
			case "command":
			case "command_output":
				return "⚙️"
			case "tool":
				return "🔧"
			case "browser_action":
			case "browser_action_launch":
			case "browser_action_result":
				return "🌐"
			case "mcp_server_request_started":
			case "mcp_server_response":
				return "🔌"
			case "api_req_started":
			case "api_req_finished":
				return "🔄"
			case "checkpoint_created":
				return "💾"
			case "info":
				return "ℹ️"
			case "generate_explanation":
				return "📝"
			default:
				return "  "
		}
	}
}

/**
 * Format timestamp
 */
function formatTimestamp(ts: number): string {
	const date = new Date(ts)
	return date.toLocaleTimeString("en-US", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	})
}
