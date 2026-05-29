import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Opens the MCP settings file in the editor
 * @param controller The controller instance
 * @param _request Empty request
 * @returns Empty response
 */
export async function openMcpSettings(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const mcpSettingsFilePath = await controller.mcpHub?.getMcpSettingsFilePath()
	if (mcpSettingsFilePath) {
		await openFileIntegration(mcpSettingsFilePath)
	}
	return Empty.create()
}
