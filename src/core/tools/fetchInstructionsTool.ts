import { Cline } from "../Cline"
import { fetchInstructions } from "../prompts/instructions/instructions"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { ToolUse } from "../assistant-message"
import { formatResponse } from "../prompts/responses"
import { AskApproval, HandleError, PushToolResult } from "./types"

export async function fetchInstructionsTool(
	cline: Cline,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
) {
	switch (true) {
		default:
			const task: string | undefined = block.params.task
			const sharedMessageProps: ClineSayTool = {
				tool: "fetchInstructions",
				content: task,
			}
			try {
				if (block.partial) {
					const partialMessage = JSON.stringify({
						...sharedMessageProps,
						content: undefined,
					} satisfies ClineSayTool)
					await cline.ask("tool", partialMessage, block.partial).catch(() => {})
					break
				} else {
					if (!task) {
						cline.consecutiveMistakeCount++
						pushToolResult(await cline.sayAndCreateMissingParamError("fetch_instructions", "task"))
						break
					}

					cline.consecutiveMistakeCount = 0
					const completeMessage = JSON.stringify({
						...sharedMessageProps,
						content: task,
					} satisfies ClineSayTool)

					const didApprove = await askApproval("tool", completeMessage)
					if (!didApprove) {
						break
					}

					// now fetch the content and provide it to the agent.
					const provider = cline.providerRef.deref()
					const mcpHub = provider?.getMcpHub()
					if (!mcpHub) {
						throw new Error("MCP hub not available")
					}
					const diffStrategy = cline.diffStrategy
					const context = provider?.context
					const content = await fetchInstructions(task, { mcpHub, diffStrategy, context })
					if (!content) {
						pushToolResult(formatResponse.toolError(`Invalid instructions request: ${task}`))
						break
					}
					pushToolResult(content)
					break
				}
			} catch (error) {
				await handleError("fetch instructions", error)
				break
			}
	}
}
