import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Deprecated compatibility handler for the removed integrated-terminal CLI install flow.
 * We intentionally keep the RPC surface for now to avoid unnecessary proto churn,
 * but the runtime no longer launches a VS Code terminal on the user's behalf.
 * @param controller The controller instance
 * @param _request The empty request
 * @returns Empty response
 */
export async function installClineCli(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const installCommand = "npm install -g cline"

	try {
		Logger.warn("installClineCli called after integrated-terminal install flow removal")
		await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: `Automatic CLI installation from the VS Code extension has been removed. Run \`${installCommand}\` manually in your terminal if you want to install Cline CLI.`,
			options: { items: [] },
		})
	} catch (error) {
		Logger.error("Error showing deprecated CLI installation notice:", error)
		await HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Failed to show CLI installation guidance: ${error instanceof Error ? error.message : "Unknown error"}`,
			options: { items: [] },
		})
	}

	return Empty.create()
}
