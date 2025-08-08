import { Controller } from "../index"
import * as proto from "@/shared/proto"
import { updateGlobalState } from "../../storage/state"
import { TerminalInfo } from "@/integrations/terminal/TerminalRegistry"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/host/window"

export async function updateDefaultTerminalProfile(
	controller: Controller,
	request: proto.cline.StringRequest,
): Promise<proto.cline.TerminalProfileUpdateResponse> {
	const profileId = request.value

	// Update the terminal profile in the state
	await updateGlobalState(controller.context, "defaultTerminalProfile", profileId)

	let closedCount = 0
	let busyTerminals: TerminalInfo[] = []

	// Update the terminal manager of the current task if it exists
	if (controller.task) {
		// Call the updated setDefaultTerminalProfile method that returns closed terminal info
		const result = controller.task.terminalManager.setDefaultTerminalProfile(profileId)
		closedCount = result.closedCount
		busyTerminals = result.busyTerminals

		// Show information message if terminals were closed
		if (closedCount > 0) {
			const message = `Closed ${closedCount} ${closedCount === 1 ? "terminal" : "terminals"} with different profile.`
			getHostBridgeProvider().windowClient.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.INFORMATION,
					message,
				}),
			)
		}

		// Show warning if there are busy terminals that couldn't be closed
		if (busyTerminals.length > 0) {
			const message =
				`${busyTerminals.length} busy ${busyTerminals.length === 1 ? "terminal has" : "terminals have"} a different profile. ` +
				`Close ${busyTerminals.length === 1 ? "it" : "them"} to use the new profile for all commands.`
			getHostBridgeProvider().windowClient.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.WARNING,
					message,
				}),
			)
		}
	}

	// Broadcast state update to all webviews
	await controller.postStateToWebview()

	return proto.cline.TerminalProfileUpdateResponse.create({
		closedCount,
		busyTerminalsCount: busyTerminals.length,
		hasBusyTerminals: busyTerminals.length > 0,
	})
}
