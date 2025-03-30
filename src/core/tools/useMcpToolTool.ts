import { Cline } from "../Cline"
import { ToolUse } from "../assistant-message"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "./types"
import { formatResponse } from "../prompts/responses"
import { ClineAskUseMcpServer } from "../../shared/ExtensionMessage"

export async function useMcpToolTool(
	cline: Cline,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const server_name: string | undefined = block.params.server_name
	const tool_name: string | undefined = block.params.tool_name
	const mcp_arguments: string | undefined = block.params.arguments
	try {
		if (block.partial) {
			const partialMessage = JSON.stringify({
				type: "use_mcp_tool",
				serverName: removeClosingTag("server_name", server_name),
				toolName: removeClosingTag("tool_name", tool_name),
				arguments: removeClosingTag("arguments", mcp_arguments),
			} satisfies ClineAskUseMcpServer)
			await cline.ask("use_mcp_server", partialMessage, block.partial).catch(() => {})
			return
		} else {
			if (!server_name) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("use_mcp_tool", "server_name"))
				return
			}
			if (!tool_name) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("use_mcp_tool", "tool_name"))
				return
			}
			// arguments are optional, but if they are provided they must be valid JSON
			// if (!mcp_arguments) {
			// 	cline.consecutiveMistakeCount++
			// 	pushToolResult(await cline.sayAndCreateMissingParamError("use_mcp_tool", "arguments"))
			// 	return
			// }
			let parsedArguments: Record<string, unknown> | undefined
			if (mcp_arguments) {
				try {
					parsedArguments = JSON.parse(mcp_arguments)
				} catch (error) {
					cline.consecutiveMistakeCount++
					await cline.say("error", `Roo tried to use ${tool_name} with an invalid JSON argument. Retrying...`)
					pushToolResult(
						formatResponse.toolError(formatResponse.invalidMcpToolArgumentError(server_name, tool_name)),
					)
					return
				}
			}
			cline.consecutiveMistakeCount = 0
			const completeMessage = JSON.stringify({
				type: "use_mcp_tool",
				serverName: server_name,
				toolName: tool_name,
				arguments: mcp_arguments,
			} satisfies ClineAskUseMcpServer)
			const didApprove = await askApproval("use_mcp_server", completeMessage)
			if (!didApprove) {
				return
			}
			// now execute the tool
			await cline.say("mcp_server_request_started") // same as browser_action_result
			const toolResult = await cline.providerRef
				.deref()
				?.getMcpHub()
				?.callTool(server_name, tool_name, parsedArguments)

			// TODO: add progress indicator and ability to parse images and non-text responses
			const toolResultPretty =
				(toolResult?.isError ? "Error:\n" : "") +
					toolResult?.content
						.map((item) => {
							if (item.type === "text") {
								return item.text
							}
							if (item.type === "resource") {
								const { blob, ...rest } = item.resource
								return JSON.stringify(rest, null, 2)
							}
							return ""
						})
						.filter(Boolean)
						.join("\n\n") || "(No response)"
			await cline.say("mcp_server_response", toolResultPretty)
			pushToolResult(formatResponse.toolResult(toolResultPretty))
			return
		}
	} catch (error) {
		await handleError("executing MCP tool", error)
		return
	}
}
