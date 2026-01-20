/**
 * Browser Action Renderer
 *
 * Handles rendering of browser-related messages including browser actions
 * and their results.
 */

import type { BrowserActionResult, ClineMessage, ClineSayBrowserAction } from "@shared/ExtensionMessage"
import type { RenderContext } from "./types.js"

/**
 * BrowserActionRenderer class
 *
 * Renders browser action messages to the terminal, including:
 * - Browser launch, click, type, scroll, and close actions
 * - Browser action results with URL and console output
 */
export class BrowserActionRenderer {
	constructor(private ctx: RenderContext) {}

	/**
	 * Render a browser action message
	 *
	 * @param msg - The ClineMessage with browser action information
	 */
	renderBrowserAction(msg: ClineMessage): void {
		if (!msg.text) {
			return
		}

		try {
			const action = JSON.parse(msg.text) as ClineSayBrowserAction
			switch (action.action) {
				case "launch":
					this.ctx.formatter.raw(`\n🌐 Browser: Launching...`)
					break
				case "click":
					this.ctx.formatter.raw(`\n🖱 Browser: Click at ${action.coordinate || "position"}`)
					break
				case "type":
					this.ctx.formatter.raw(`\n⌨ Browser: Type "${action.text || ""}"`)
					break
				case "scroll_down":
					this.ctx.formatter.raw(`\n📜 Browser: Scroll down`)
					break
				case "scroll_up":
					this.ctx.formatter.raw(`\n📜 Browser: Scroll up`)
					break
				case "close":
					this.ctx.formatter.raw(`\n🌐 Browser: Closing...`)
					break
			}
		} catch {
			this.ctx.formatter.raw(`\n🌐 Browser: ${msg.text}`)
		}
	}

	/**
	 * Render a browser action result message
	 *
	 * @param msg - The ClineMessage with browser action result
	 */
	renderBrowserActionResult(msg: ClineMessage): void {
		if (!msg.text) {
			return
		}

		try {
			const result = JSON.parse(msg.text) as BrowserActionResult
			if (result.currentUrl) {
				this.ctx.formatter.raw(`  URL: ${result.currentUrl}`)
			}
			if (result.logs) {
				this.ctx.formatter.raw(`  Console: ${result.logs}`)
			}
			// Note: Screenshots are not displayed in terminal
			if (result.screenshot) {
				this.ctx.formatter.raw(`  📷 Screenshot captured`)
			}
		} catch {
			this.ctx.formatter.raw(`  ${msg.text}`)
		}
	}
}
