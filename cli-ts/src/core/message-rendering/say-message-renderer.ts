/**
 * Say Message Renderer
 *
 * Handles rendering of "say" type ClineMessages, which are informational
 * messages that don't require user input.
 */

import type { ClineApiReqInfo, ClineMessage } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import type { BrowserActionRenderer } from "./browser-action-renderer.js"
import type { ToolRenderer } from "./tool-renderer.js"
import type { RenderContext } from "./types.js"

/**
 * SayMessageRenderer class
 *
 * Renders "say" type messages to the terminal, including:
 * - Task information
 * - AI text and reasoning
 * - Errors and retries
 * - API request status
 * - Command output
 * - Tool and browser actions
 * - Checkpoints
 */
export class SayMessageRenderer {
	constructor(
		private ctx: RenderContext,
		private toolRenderer: ToolRenderer,
		private browserRenderer: BrowserActionRenderer,
	) {}

	/**
	 * Render a "say" type message
	 *
	 * @param msg - The ClineMessage to render
	 */
	render(msg: ClineMessage): void {
		const say = msg.say

		switch (say) {
			case "task":
				this.ctx.formatter.info(`\n📋 Task: ${msg.text || ""}`)
				break

			case "text":
			case "reasoning":
				if (msg.text) {
					// Check if this is reasoning content
					if (say === "reasoning" || msg.reasoning) {
						this.ctx.formatter.raw(`💭 ${msg.reasoning || msg.text}`)
					} else {
						this.ctx.formatter.raw(msg.text)
					}
				}
				break

			case "error":
				this.ctx.formatter.error(`❌ ${msg.text || "An error occurred"}`)
				break

			case "error_retry":
				this.ctx.formatter.warn(`🔄 Retrying: ${msg.text || ""}`)
				break

			case "api_req_started":
				this.renderApiReqStarted()
				break

			case "api_req_finished":
				this.renderApiReqFinished(msg)
				break

			case "completion_result":
				this.ctx.formatter.success(`\n✨ ${msg.text || "Task completed"}`)
				break

			case "user_feedback":
				this.ctx.formatter.info(`📝 User: ${msg.text || ""}`)
				break

			case "command":
				this.ctx.formatter.raw(`\n$ ${msg.text || ""}`)
				break

			case "command_output":
				if (msg.text) {
					// Indent command output
					const lines = msg.text.split("\n")
					for (const line of lines) {
						this.ctx.formatter.raw(`  ${line}`)
					}
				}
				break

			case "tool":
				this.toolRenderer.renderToolMessage(msg)
				break

			case "browser_action":
				this.browserRenderer.renderBrowserAction(msg)
				break

			case "browser_action_result":
				this.browserRenderer.renderBrowserActionResult(msg)
				break

			case "mcp_server_request_started":
				this.ctx.formatter.info(`🔌 MCP request: ${msg.text || ""}`)
				break

			case "mcp_server_response":
				this.ctx.formatter.raw(`  Response: ${msg.text || ""}`)
				break

			case "checkpoint_created":
				// Display checkpoint ID (timestamp) so users can reference it for /restore
				const hashInfo = msg.lastCheckpointHash ? ` (${msg.lastCheckpointHash.slice(0, 8)})` : ""
				this.ctx.formatter.info(`💾 Checkpoint created [ID: ${msg.ts}]${hashInfo}`)
				break

			case "shell_integration_warning":
				this.ctx.formatter.warn(`! Shell integration: ${msg.text || ""}`)
				break

			case "diff_error":
				this.ctx.formatter.error(`❌ Diff error: ${msg.text || ""}`)
				break

			case "task_progress":
				this.ctx.formatter.info("Making Progress...")
				break

			default:
				// Handle any other say types
				if (msg.text) {
					this.ctx.formatter.raw(msg.text)
				}
		}
	}

	/**
	 * Render API request started message with cumulative session metrics
	 */
	private renderApiReqStarted(): void {
		// Show cumulative session token usage
		const messages = this.ctx.getMessages()
		const metrics = getApiMetrics(messages)
		const parts: string[] = []

		// Token counts
		parts.push(`${metrics.totalTokensIn.toLocaleString()} in / ${metrics.totalTokensOut.toLocaleString()} out`)

		// Cache info if available
		if (metrics.totalCacheReads !== undefined || metrics.totalCacheWrites !== undefined) {
			const cacheReads = metrics.totalCacheReads ?? 0
			const cacheWrites = metrics.totalCacheWrites ?? 0
			parts.push(`cache: ${cacheReads.toLocaleString()}r/${cacheWrites.toLocaleString()}w`)
		}

		// Cost
		if (metrics.totalCost > 0) {
			parts.push(`$${metrics.totalCost.toFixed(4)}`)
		}

		this.ctx.formatter.info(`🔄 API request started... [Session: ${parts.join(" | ")}]`)
	}

	/**
	 * Render API request finished message with token counts and cost
	 */
	private renderApiReqFinished(msg: ClineMessage): void {
		if (msg.text) {
			try {
				const info = JSON.parse(msg.text) as ClineApiReqInfo
				const tokens = `${info.tokensIn || 0} in / ${info.tokensOut || 0} out`
				const cost = info.cost ? ` ($${info.cost.toFixed(4)})` : ""
				this.ctx.formatter.success(`✅ API request complete: ${tokens}${cost}`)
			} catch {
				this.ctx.formatter.success("✅ API request complete")
			}
		}
	}
}
