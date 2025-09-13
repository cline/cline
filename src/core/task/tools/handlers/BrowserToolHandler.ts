import { BrowserSession } from "@services/browser/BrowserSession"
import { BrowserAction, BrowserActionResult, browserActions, ClineSayBrowserAction } from "@shared/ExtensionMessage"
import { modelDoesntSupportWebp } from "@utils/model-utils"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class BrowserToolHandler implements IFullyManagedTool {
	readonly name = "browser_action"

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.action}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const action: BrowserAction | undefined = block.params.action as BrowserAction
		const url: string | undefined = block.params.url
		const coordinate: string | undefined = block.params.coordinate
		const text: string | undefined = block.params.text

		// Validate action parameter
		if (!action || !browserActions.includes(action)) {
			return // Wait for more content
		}

		// Handle partial block streaming - exact original logic
		if (action === "launch") {
			if (uiHelpers.shouldAutoApproveTool(block.name)) {
				await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "browser_action_launch")
				await uiHelpers.say(
					"browser_action_launch",
					uiHelpers.removeClosingTag(block, "url", url),
					undefined,
					undefined,
					block.partial,
				)
			} else {
				await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "browser_action_launch")
				await uiHelpers
					.ask("browser_action_launch", uiHelpers.removeClosingTag(block, "url", url), block.partial)
					.catch(() => {})
			}
		} else {
			await uiHelpers.say(
				"browser_action",
				JSON.stringify({
					action: action as BrowserAction,
					coordinate: uiHelpers.removeClosingTag(block, "coordinate", coordinate),
					text: uiHelpers.removeClosingTag(block, "text", text),
				} satisfies ClineSayBrowserAction),
				undefined,
				undefined,
				block.partial,
			)
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, don't execute yet
		if (block.partial) {
			return ""
		}

		const action: BrowserAction | undefined = block.params.action as BrowserAction
		const url: string | undefined = block.params.url
		const coordinate: string | undefined = block.params.coordinate
		const text: string | undefined = block.params.text

		// Validate action parameter - following original pattern
		if (!action || !browserActions.includes(action)) {
			// if the block is complete and we don't have a valid action this is a mistake
			config.taskState.consecutiveMistakeCount++
			const errorResult = await config.callbacks.sayAndCreateMissingParamError("browser_action", "action")
			await config.services.browserSession.closeBrowser()
			await config.callbacks.saveCheckpoint()
			return errorResult
		}

		try {
			// Handle complete block execution
			let browserActionResult: BrowserActionResult

			if (action === "launch") {
				if (!url) {
					config.taskState.consecutiveMistakeCount++
					const errorResult = await config.callbacks.sayAndCreateMissingParamError("browser_action", "url")
					await config.services.browserSession.closeBrowser()
					await config.callbacks.saveCheckpoint()
					return errorResult
				}
				config.taskState.consecutiveMistakeCount = 0

				// Handle approval flow for launch using callbacks
				const autoApprover = config.autoApprover || { shouldAutoApproveTool: () => false }
				if (autoApprover.shouldAutoApproveTool(block.name)) {
					await config.callbacks.say("browser_action_launch", url, undefined, undefined, false)
					config.taskState.consecutiveAutoApprovedRequestsCount++
				} else {
					// Show notification for approval if auto approval enabled
					const { showNotificationForApprovalIfAutoApprovalEnabled } = require("../../utils")
					showNotificationForApprovalIfAutoApprovalEnabled(
						`Cline wants to use a browser and launch ${url}`,
						config.autoApprovalSettings.enabled,
						config.autoApprovalSettings.enableNotifications,
					)

					const { response } = await config.callbacks.ask("browser_action_launch", url, false)
					if (response !== "yesButtonClicked") {
						await config.callbacks.saveCheckpoint()
						return formatResponse.toolResult("The user rejected this browser action.")
					}
				}

				// Start loading spinner
				await config.callbacks.say("browser_action_result", "")

				// Re-make browserSession to make sure latest settings apply
				const browserSession = config.services.browserSession
				if (config.context) {
					await browserSession.dispose()
					const apiHandlerModel = config.api.getModel()
					const useWebp = config.api ? !modelDoesntSupportWebp(apiHandlerModel) : true
					config.services.browserSession = new BrowserSession(config.context, config.browserSettings, useWebp)
				} else {
					console.warn("no controller context available for browserSession")
				}
				await config.services.browserSession.launchBrowser()
				browserActionResult = await config.services.browserSession.navigateToUrl(url)
			} else {
				// Handle other actions (click, type, scroll, close)
				if (action === "click") {
					if (!coordinate) {
						config.taskState.consecutiveMistakeCount++
						const errorResult = await config.callbacks.sayAndCreateMissingParamError("browser_action", "coordinate")
						await config.services.browserSession.closeBrowser()
						await config.callbacks.saveCheckpoint()
						return errorResult
					}
				}
				if (action === "type") {
					if (!text) {
						config.taskState.consecutiveMistakeCount++
						const errorResult = await config.callbacks.sayAndCreateMissingParamError("browser_action", "text")
						await config.services.browserSession.closeBrowser()
						await config.callbacks.saveCheckpoint()
						return errorResult
					}
				}
				config.taskState.consecutiveMistakeCount = 0

				// Send browser action message
				await config.callbacks.say(
					"browser_action",
					JSON.stringify({
						action: action as BrowserAction,
						coordinate,
						text,
					} satisfies ClineSayBrowserAction),
					undefined,
					undefined,
					false,
				)

				// Execute the action
				const browserSession = config.services.browserSession
				switch (action) {
					case "click":
						browserActionResult = await browserSession.click(coordinate!)
						break
					case "type":
						browserActionResult = await browserSession.type(text!)
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
				}
			}

			// Handle results based on action type
			switch (action) {
				case "launch":
				case "click":
				case "type":
				case "scroll_down":
				case "scroll_up":
					await config.callbacks.say("browser_action_result", JSON.stringify(browserActionResult))
					const result = formatResponse.toolResult(
						`The browser action has been executed. The console logs and screenshot have been captured for your analysis.\n\nConsole logs:\n${
							browserActionResult.logs || "(No new logs)"
						}\n\n(REMEMBER: if you need to proceed to using non-\`browser_action\` tools or launch a new browser, you MUST first close this browser. For example, if after analyzing the logs and screenshot you need to edit a file, you must first close the browser before you can use the write_to_file tool.)`,
						browserActionResult.screenshot ? [browserActionResult.screenshot] : [],
					)

					await config.callbacks.saveCheckpoint()
					return result

				case "close":
					const closeResult = formatResponse.toolResult(
						`The browser has been closed. You may now proceed to using other tools.`,
					)
					await config.callbacks.saveCheckpoint()
					return closeResult
			}
		} catch (error) {
			await config.services.browserSession.closeBrowser() // if any error occurs, the browser session is terminated
			return `Error executing browser action: ${(error as Error).message}`
		}

		// This should never be reached, but TypeScript requires a return
		return ""
	}
}
