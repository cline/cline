import { ClineAskUseMcpServer } from "../../shared/ExtensionMessage"
import { ToolUse, RemoveClosingTag, AskApproval, HandleError, PushToolResult } from "../../shared/tools"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"

export async function accessMcpResourceTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const server_name: string | undefined = block.params.server_name
	const uri: string | undefined = block.params.uri

	try {
		if (block.partial) {
			const partialMessage = JSON.stringify({
				type: "access_mcp_resource",
				serverName: removeClosingTag("server_name", server_name),
				uri: removeClosingTag("uri", uri),
			} satisfies ClineAskUseMcpServer)

			await cline.ask("use_mcp_server", partialMessage, block.partial).catch(() => {})
			return
		} else {
			if (!server_name) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("access_mcp_resource")
				pushToolResult(await cline.sayAndCreateMissingParamError("access_mcp_resource", "server_name"))
				return
			}

			if (!uri) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("access_mcp_resource")
				pushToolResult(await cline.sayAndCreateMissingParamError("access_mcp_resource", "uri"))
				return
			}

			cline.consecutiveMistakeCount = 0

			const completeMessage = JSON.stringify({
				type: "access_mcp_resource",
				serverName: server_name,
				uri,
			} satisfies ClineAskUseMcpServer)

			const didApprove = await askApproval("use_mcp_server", completeMessage)

			if (!didApprove) {
				return
			}

			// Now execute the tool
			await cline.say("mcp_server_request_started")
			const resourceResult = await cline.providerRef.deref()?.getMcpHub()?.readResource(server_name, uri)

			const resourceResultPretty =
				resourceResult?.contents
					.map((item) => {
						// First check if text content is available
						if (item.text) {
							return item.text
						}

						// If no text but blob exists, check if it's text-based content
						if (item.blob && item.mimeType) {
							// Handle text-based MIME types
							if (
								item.mimeType.startsWith("text/") ||
								item.mimeType === "application/json" ||
								item.mimeType === "application/xml" ||
								item.mimeType === "application/javascript" ||
								item.mimeType === "application/typescript"
							) {
								try {
									// Try to decode as base64 first
									if (item.blob.match(/^[A-Za-z0-9+/]*={0,2}$/)) {
										return Buffer.from(item.blob, "base64").toString("utf-8")
									} else {
										// If not base64, treat as raw text
										return item.blob
									}
								} catch (error) {
									// If base64 decoding fails, treat as raw text
									return item.blob
								}
							}
						}

						return ""
					})
					.filter(Boolean)
					.join("\n\n") || "(Empty response)"

			// Handle images (image must contain mimetype and blob)
			let images: string[] = []

			resourceResult?.contents.forEach((item) => {
				if (item.mimeType?.startsWith("image") && item.blob) {
					if (item.blob.startsWith("data:")) {
						images.push(item.blob)
					} else {
						images.push(`data:${item.mimeType};base64,` + item.blob)
					}
				}
			})

			await cline.say("mcp_server_response", resourceResultPretty, images)
			pushToolResult(formatResponse.toolResult(resourceResultPretty, images))

			return
		}
	} catch (error) {
		await handleError("accessing MCP resource", error)
		return
	}
}
