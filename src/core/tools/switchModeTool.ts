import delay from "delay"

import { Cline } from "../Cline"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { defaultModeSlug, getModeBySlug } from "../../shared/modes"

export async function switchModeTool(
	cline: Cline,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const mode_slug: string | undefined = block.params.mode_slug
	const reason: string | undefined = block.params.reason

	try {
		if (block.partial) {
			const partialMessage = JSON.stringify({
				tool: "switchMode",
				mode: removeClosingTag("mode_slug", mode_slug),
				reason: removeClosingTag("reason", reason),
			})

			await cline.ask("tool", partialMessage, block.partial).catch(() => {})
			return
		} else {
			if (!mode_slug) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("switch_mode")
				pushToolResult(await cline.sayAndCreateMissingParamError("switch_mode", "mode_slug"))
				return
			}

			cline.consecutiveMistakeCount = 0

			// Verify the mode exists
			const targetMode = getModeBySlug(mode_slug, (await cline.providerRef.deref()?.getState())?.customModes)

			if (!targetMode) {
				cline.recordToolError("switch_mode")
				pushToolResult(formatResponse.toolError(`Invalid mode: ${mode_slug}`))
				return
			}

			// Check if already in requested mode
			const currentMode = (await cline.providerRef.deref()?.getState())?.mode ?? defaultModeSlug

			if (currentMode === mode_slug) {
				cline.recordToolError("switch_mode")
				pushToolResult(`Already in ${targetMode.name} mode.`)
				return
			}

			const completeMessage = JSON.stringify({ tool: "switchMode", mode: mode_slug, reason })
			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			// Switch the mode using shared handler
			await cline.providerRef.deref()?.handleModeSwitch(mode_slug)

			pushToolResult(
				`Successfully switched from ${getModeBySlug(currentMode)?.name ?? currentMode} mode to ${
					targetMode.name
				} mode${reason ? ` because: ${reason}` : ""}.`,
			)

			await delay(500) // Delay to allow mode change to take effect before next tool is executed

			return
		}
	} catch (error) {
		await handleError("switching mode", error)
		return
	}
}
