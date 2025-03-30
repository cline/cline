import { Cline } from "../Cline"
import { ToolUse } from "../assistant-message"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "./types"
import { formatResponse } from "../prompts/responses"

export async function executeCommandTool(
	cline: Cline,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	let command: string | undefined = block.params.command
	const customCwd: string | undefined = block.params.cwd
	try {
		if (block.partial) {
			await cline.ask("command", removeClosingTag("command", command), block.partial).catch(() => {})
			return
		} else {
			if (!command) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("execute_command", "command"))
				return
			}

			const ignoredFileAttemptedToAccess = cline.rooIgnoreController?.validateCommand(command)
			if (ignoredFileAttemptedToAccess) {
				await cline.say("rooignore_error", ignoredFileAttemptedToAccess)
				pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(ignoredFileAttemptedToAccess)))

				return
			}

			// unescape html entities (e.g. &lt; -> <)
			command = command.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")

			cline.consecutiveMistakeCount = 0

			const didApprove = await askApproval("command", command)
			if (!didApprove) {
				return
			}
			const [userRejected, result] = await cline.executeCommandTool(command, customCwd)
			if (userRejected) {
				cline.didRejectTool = true
			}
			pushToolResult(result)
			return
		}
	} catch (error) {
		await handleError("executing command", error)
		return
	}
}
