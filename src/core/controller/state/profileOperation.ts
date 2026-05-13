import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function profileOperation(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		const { operation, profileId, profile } = JSON.parse(request.value)

		switch (operation) {
			case "create":
				if (profile) {
					controller.stateManager.addApiConfigProfile(profile)
				}
				break
			case "update":
				if (profileId && profile) {
					controller.stateManager.updateApiConfigProfile(profileId, profile)
				}
				break
			case "delete":
				if (profileId) {
					controller.stateManager.deleteApiConfigProfile(profileId)
				}
				break
			case "apply":
				if (profileId) {
					controller.stateManager.applyApiConfigProfile(profileId)
				}
				break
		}

		await controller.postStateToWebview()
	} catch (error) {
		console.error("[profileOperation] Error:", error)
	}

	return Empty.create({})
}
