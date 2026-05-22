import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

const activeSkillsButtonClickedSubscriptions = new Set<StreamingResponseHandler<Empty>>()

export async function subscribeToSkillsButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	activeSkillsButtonClickedSubscriptions.add(responseStream)

	const cleanup = () => {
		activeSkillsButtonClickedSubscriptions.delete(responseStream)
	}

	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "skillsButtonClicked_subscription" }, responseStream)
	}
}

export async function sendSkillsButtonClickedEvent(): Promise<void> {
	const promises = Array.from(activeSkillsButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(Empty.create({}), false)
		} catch (error) {
			console.error("Error sending skillsButtonClicked event:", error)
			activeSkillsButtonClickedSubscriptions.delete(responseStream)
		}
	})
	await Promise.all(promises)
}
