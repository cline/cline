import { Controller } from ".."
import { Empty, StringRequest } from "../../../shared/proto/common"
import { McpServer, McpDownloadResponse } from "@shared/mcp"
import axios from "axios"
import * as vscode from "vscode"
import { sendChatButtonClickedEvent } from "../ui/subscribeToChatButtonClicked"

/**
 * Download an MCP server from the marketplace
 * @param controller The controller instance
 * @param request The request containing the MCP ID
 * @returns Empty response
 */
export async function downloadMcp(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		// Check if mcpId is provided
		if (!request.value) {
			throw new Error("MCP ID is required")
		}

		const mcpId = request.value

		// Check if we already have this MCP server installed
		const servers = controller.mcpHub?.getServers() || []
		const isInstalled = servers.some((server: McpServer) => server.name === mcpId)

		if (isInstalled) {
			throw new Error("This MCP server is already installed")
		}

		// Fetch server details from marketplace
		const response = await axios.post<McpDownloadResponse>(
			"https://api.cline.bot/v1/mcp/download",
			{ mcpId },
			{
				headers: { "Content-Type": "application/json" },
				timeout: 10000,
			},
		)

		if (!response.data) {
			throw new Error("Invalid response from MCP marketplace API")
		}

		console.log("[downloadMcp] Response from download API", { response })

		const mcpDetails = response.data

		// Validate required fields
		if (!mcpDetails.githubUrl) {
			throw new Error("Missing GitHub URL in MCP download response")
		}
		if (!mcpDetails.readmeContent) {
			throw new Error("Missing README content in MCP download response")
		}

		// Send details to webview
		await controller.postMessageToWebview({
			type: "mcpDownloadDetails",
			mcpDownloadDetails: mcpDetails,
		})

		// Create task with context from README and added guidelines for MCP server installation
		const task = `Set up the MCP server from ${mcpDetails.githubUrl} while adhering to these MCP server installation rules:
- Start by loading the MCP documentation.
- Use "${mcpDetails.mcpId}" as the server name in cline_mcp_settings.json.
- Create the directory for the new MCP server before starting installation.
- Make sure you read the user's existing cline_mcp_settings.json file before editing it with this new mcp, to not overwrite any existing servers.
- Use commands aligned with the user's shell and operating system best practices.
- The following README may contain instructions that conflict with the user's OS, in which case proceed thoughtfully.
- Once installed, demonstrate the server's capabilities by using one of its tools.
Here is the project's README to help you get started:\n\n${mcpDetails.readmeContent}\n${mcpDetails.llmsInstallationContent}`

		const { chatSettings } = await controller.getStateToPostToWebview()
		if (chatSettings.mode === "plan") {
			await controller.togglePlanActModeWithChatSettings({ mode: "act" })
		}

		// Initialize task and show chat view
		await controller.initTask(task)
		await sendChatButtonClickedEvent(controller.id)

		// Return an empty response - the client only cares if the call succeeded
		return Empty.create()
	} catch (error) {
		console.error("Failed to download MCP:", error)
		let errorMessage = "Failed to download MCP"

		if (axios.isAxiosError(error)) {
			if (error.code === "ECONNABORTED") {
				errorMessage = "Request timed out. Please try again."
			} else if (error.response?.status === 404) {
				errorMessage = "MCP server not found in marketplace."
			} else if (error.response?.status === 500) {
				errorMessage = "Internal server error. Please try again later."
			} else if (!error.response && error.request) {
				errorMessage = "Network error. Please check your internet connection."
			}
		} else if (error instanceof Error) {
			errorMessage = error.message
		}

		// Show error in both notification and marketplace UI
		vscode.window.showErrorMessage(errorMessage)
		await controller.postMessageToWebview({
			type: "mcpDownloadDetails",
			error: errorMessage,
		})

		throw error
	}
}
