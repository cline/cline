import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { ClineAskUseMcpServer } from "../../shared/ExtensionMessage"

export async function useMcpToolTool(
	cline: Task,
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
				cline.recordToolError("use_mcp_tool")
				pushToolResult(await cline.sayAndCreateMissingParamError("use_mcp_tool", "server_name"))
				return
			}

			if (!tool_name) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("use_mcp_tool")
				pushToolResult(await cline.sayAndCreateMissingParamError("use_mcp_tool", "tool_name"))
				return
			}

			let parsedArguments: Record<string, unknown> | undefined

			if (mcp_arguments) {
				try {
					// First try to parse as JSON directly
					parsedArguments = JSON.parse(mcp_arguments)
				} catch (error) {
					// If direct parsing fails, try to handle it as a raw string that might need escaping
					try {
						// Check if it looks like a JSON object already (starts with { or [)
						const trimmed = mcp_arguments.trim()
						if (
							(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
							(trimmed.startsWith("[") && trimmed.endsWith("]"))
						) {
							// If it looks like JSON but couldn't be parsed, then it's truly invalid
							cline.consecutiveMistakeCount++
							cline.recordToolError("use_mcp_tool")
							await cline.say(
								"error",
								`Roo tried to use ${tool_name} with an invalid JSON argument. Retrying...`,
							)

							pushToolResult(
								formatResponse.toolError(
									formatResponse.invalidMcpToolArgumentError(server_name, tool_name),
								),
							)
							return
						}

						// Otherwise, handle it as a raw string input - automatically place it in a properly escaped JSON object
						// This assumes the MCP tool expects an object with an 'input_data' field
						parsedArguments = {
							input_data: mcp_arguments,
						}

						console.log("Auto-escaped code for MCP tool:", tool_name)
					} catch (nestedError) {
						cline.consecutiveMistakeCount++
						cline.recordToolError("use_mcp_tool")
						await cline.say("error", `Failed to process arguments for ${tool_name}. Please try again.`)

						pushToolResult(
							formatResponse.toolError(
								formatResponse.invalidMcpToolArgumentError(server_name, tool_name),
							),
						)
						return
					}
				}
			}

			cline.consecutiveMistakeCount = 0

			// Create the approval message with the properly formatted arguments
			const completeMessage = JSON.stringify({
				type: "use_mcp_tool",
				serverName: server_name,
				toolName: tool_name,
				arguments: parsedArguments ? JSON.stringify(parsedArguments) : mcp_arguments,
			} satisfies ClineAskUseMcpServer)

			const didApprove = await askApproval("use_mcp_server", completeMessage)

			if (!didApprove) {
				return
			}

			// Now execute the tool
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
								const { blob: _, ...rest } = item.resource
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
