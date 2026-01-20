/**
 * Ask Message Renderer
 *
 * Handles rendering of "ask" type ClineMessages, which require user input
 * or approval. Also includes MCP server approval rendering.
 */

import type { ClineAskQuestion, ClineAskUseMcpServer, ClineMessage, ClinePlanModeResponse } from "@shared/ExtensionMessage"
import { renderMarkdown } from "./markdown-renderer.js"
import type { ToolRenderer } from "./tool-renderer.js"
import type { RenderContext } from "./types.js"

/**
 * AskMessageRenderer class
 *
 * Renders "ask" type messages to the terminal, including:
 * - Followup questions with options
 * - Command approval requests
 * - Tool approval requests
 * - API failure prompts
 * - Browser launch approval
 * - MCP server approval
 * - Plan mode responses
 */
export class AskMessageRenderer {
	constructor(
		private ctx: RenderContext,
		private toolRenderer: ToolRenderer,
	) {}

	/**
	 * Render an "ask" type message
	 *
	 * @param msg - The ClineMessage to render
	 */
	render(msg: ClineMessage): void {
		const ask = msg.ask

		switch (ask) {
			case "followup":
				this.renderFollowupQuestion(msg)
				break

			case "plan_mode_respond":
				this.renderPlanModeResponse(msg)
				break

			case "command":
				this.ctx.formatter.raw(`\n💻 Execute command?`)
				this.ctx.formatter.raw(`  $ ${msg.text || ""}`)
				this.ctx.formatter.info("  [y/n] or [yy to auto-approve commands]")
				break

			case "tool":
				this.toolRenderer.renderToolApproval(msg)
				break

			case "api_req_failed":
				this.ctx.formatter.error(`\n❌ API request failed`)
				if (msg.text) {
					this.ctx.formatter.raw(`  ${msg.text}`)
				}
				this.ctx.formatter.info("  [retry/cancel]")
				break

			case "resume_task":
				// this.ctx.formatter.info(`\n⏸ Task paused. Resume?`)
				// this.ctx.formatter.info("  [yes/no]")
				break

			case "completion_result":
				// TODO end process if yolo mode
				this.ctx.formatter.success(`\n✅ Task Complete!`)
				if (msg.text) {
					this.ctx.formatter.raw(msg.text)
				}
				break

			case "browser_action_launch":
				this.ctx.formatter.raw(`\n🌐 Launch browser?`)
				if (msg.text) {
					this.ctx.formatter.raw(`  URL: ${msg.text}`)
				}
				this.ctx.formatter.info("  [y/n] or [yy to auto-approve browser]")
				break

			case "use_mcp_server":
				this.renderMcpServerApproval(msg)
				break

			case "mistake_limit_reached":
				this.ctx.formatter.warn(`\n! Mistake limit reached`)
				if (msg.text) {
					this.ctx.formatter.raw(msg.text)
				}
				this.ctx.formatter.info("  [continue/stop]")
				break

			default:
				if (msg.text) {
					this.ctx.formatter.raw(`\n❓ ${msg.text}`)
				}
		}
	}

	/**
	 * Render a followup question with numbered options
	 *
	 * @param msg - The ClineMessage with question information
	 */
	private renderFollowupQuestion(msg: ClineMessage): void {
		// Clear previous options
		this.ctx.setCurrentOptions([])

		if (!msg.text) {
			this.ctx.formatter.raw(`\n❓ Question`)
			return
		}

		try {
			const question = JSON.parse(msg.text) as ClineAskQuestion
			this.ctx.formatter.raw(`\n❓ ${question.question}`)

			// Display options as numbered list if present
			if (question.options && question.options.length > 0) {
				this.ctx.setCurrentOptions(question.options)
				this.ctx.formatter.raw("")
				for (let i = 0; i < question.options.length; i++) {
					this.ctx.formatter.raw(`  ${i + 1}. ${question.options[i]}`)
				}
				this.ctx.formatter.raw("")
				this.ctx.formatter.info("  Enter a number to select, or type your response:")
			}
		} catch {
			// Not JSON, output as plain text
			this.ctx.formatter.raw(`\n❓ ${msg.text}`)
		}
	}

	/**
	 * Render a plan mode response with markdown rendering
	 *
	 * @param msg - The ClineMessage with plan mode response
	 */
	private renderPlanModeResponse(msg: ClineMessage): void {
		// Clear previous options
		this.ctx.setCurrentOptions([])

		if (!msg.text) {
			this.ctx.formatter.info(`\n📝 Plan Mode Response Required`)
			return
		}

		try {
			const planResponse = JSON.parse(msg.text) as ClinePlanModeResponse

			this.ctx.formatter.raw("")
			// Render the markdown response
			const rendered = renderMarkdown(planResponse.response)
			this.ctx.formatter.raw(rendered)

			// Display options as numbered list if present
			if (planResponse.options && planResponse.options.length > 0) {
				this.ctx.setCurrentOptions(planResponse.options)
				this.ctx.formatter.raw("")
				for (let i = 0; i < planResponse.options.length; i++) {
					this.ctx.formatter.raw(`  ${i + 1}. ${planResponse.options[i]}`)
				}
				this.ctx.formatter.raw("")
				this.ctx.formatter.info("  Enter a number to select, or type your response:")
			} else {
				this.ctx.formatter.raw("")
				this.ctx.formatter.info("  Toggle to Act mode to execute, or provide feedback:")
			}
		} catch {
			// Not JSON, output as plain text
			this.ctx.formatter.info(`\n📝 Plan Mode Response Required`)
			this.ctx.formatter.raw(msg.text)
		}
	}

	/**
	 * Render MCP server approval request
	 *
	 * @param msg - The ClineMessage with MCP server information
	 */
	private renderMcpServerApproval(msg: ClineMessage): void {
		if (!msg.text) {
			this.ctx.formatter.raw(`\n🔌 MCP server approval required`)
			return
		}

		try {
			const mcp = JSON.parse(msg.text) as ClineAskUseMcpServer
			this.ctx.formatter.raw(`\n🔌 MCP: ${mcp.serverName}`)
			if (mcp.type === "use_mcp_tool" && mcp.toolName) {
				this.ctx.formatter.raw(`  Tool: ${mcp.toolName}`)
				if (mcp.arguments) {
					this.ctx.formatter.raw(`  Args: ${mcp.arguments}`)
				}
			} else if (mcp.type === "access_mcp_resource" && mcp.uri) {
				this.ctx.formatter.raw(`  Resource: ${mcp.uri}`)
			}
			this.ctx.formatter.info("  [y/n] or [yy to auto-approve MCP]")
		} catch {
			this.ctx.formatter.raw(`\n🔌 MCP approval: ${msg.text}`)
			this.ctx.formatter.info("  [y/n] or [yy to auto-approve MCP]")
		}
	}
}
