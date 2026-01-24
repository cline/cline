import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { ExecuteCommandInTerminalRequest } from "@shared/proto/host/workspace"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."
import { getCoreMessage } from "../../coreMessages"

/**
 * Handles the installation of the Cline CLI tool
 * @param controller The controller instance
 * @param _request The empty request
 * @returns Empty response
 */
export async function installClineCli(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const installCommand = "npm install -g cline"

	try {
		// Use the HostProvider to execute the command in a terminal
		// This works across different platforms (VSCode, JetBrains, etc.)
		const response = await HostProvider.workspace.executeCommandInTerminal(
			ExecuteCommandInTerminalRequest.create({
				command: installCommand,
			}),
		)

		if (!response.success) {
			throw new Error("Failed to execute command in terminal")
		}
	} catch (error) {
		Logger.error("Error executing CLI installation:", error)
		await HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: getCoreMessage("installCliFailed", {
				error: error instanceof Error ? error.message : getCoreMessage("unknownErrorOccurred"),
			}),
			options: { items: [] },
		})
	}

	return Empty.create()
}
