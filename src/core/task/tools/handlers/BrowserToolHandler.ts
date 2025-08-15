import { BrowserSession } from "@services/browser/BrowserSession"
import { BrowserAction, BrowserActionResult, browserActions } from "@shared/ExtensionMessage"
import { modelDoesntSupportWebp } from "@utils/model-utils"
import { ToolResponse } from "../.."
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import { ToolUseName } from "../../../assistant-message"

export class BrowserToolHandler implements IToolHandler {
	name = "browser"
	supportedTools: ToolUseName[] = ["browser_action"]

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		const action: BrowserAction | undefined = block.params.action as BrowserAction
		const url: string | undefined = block.params.url
		const coordinate: string | undefined = block.params.coordinate
		const text: string | undefined = block.params.text

		// Validate action
		if (!action || !browserActions.includes(action)) {
			throw new Error(`Invalid or missing browser action: ${action}`)
		}

		const browserSession: BrowserSession = config.services.browserSession

		let browserActionResult: BrowserActionResult

		switch (action) {
			case "launch":
				if (!url) {
					throw new Error("URL is required for browser launch action")
				}

				// Re-make browserSession to make sure latest settings apply
				if (config.context) {
					await browserSession.dispose()
					const useWebp = config.api ? !modelDoesntSupportWebp(config.api) : true
					const newBrowserSession = new BrowserSession(config.context, config.browserSettings, useWebp)
					// Update the browserSession reference
					config.services.browserSession = newBrowserSession
					await newBrowserSession.launchBrowser()
					browserActionResult = await newBrowserSession.navigateToUrl(url)
				} else {
					console.warn("no controller context available for browserSession")
					await browserSession.launchBrowser()
					browserActionResult = await browserSession.navigateToUrl(url)
				}
				break

			case "click":
				if (!coordinate) {
					throw new Error("Coordinate is required for click action")
				}
				browserActionResult = await browserSession.click(coordinate)
				break

			case "type":
				if (!text) {
					throw new Error("Text is required for type action")
				}
				browserActionResult = await browserSession.type(text)
				break

			case "scroll_down":
				browserActionResult = await browserSession.scrollDown()
				break

			case "scroll_up":
				browserActionResult = await browserSession.scrollUp()
				break

			case "close":
				browserActionResult = await browserSession.closeBrowser()
				break

			default:
				throw new Error(`Unknown browser action: ${action}`)
		}

		// Return appropriate result based on action
		switch (action) {
			case "launch":
			case "click":
			case "type":
			case "scroll_down":
			case "scroll_up":
				return formatResponse.toolResult(
					`The browser action has been executed. The console logs and screenshot have been captured for your analysis.\n\nConsole logs:\n${
						browserActionResult.logs || "(No new logs)"
					}\n\n(REMEMBER: if you need to proceed to using non-\`browser_action\` tools or launch a new browser, you MUST first close this browser. For example, if after analyzing the logs and screenshot you need to edit a file, you must first close the browser before you can use the write_to_file tool.)`,
					browserActionResult.screenshot ? [browserActionResult.screenshot] : [],
				)

			case "close":
				return formatResponse.toolResult(`The browser has been closed. You may now proceed to using other tools.`)
		}
	}
}
