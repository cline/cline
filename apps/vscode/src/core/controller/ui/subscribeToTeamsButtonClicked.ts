import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

const subscriptions = new Set<StreamingResponseHandler<Empty>>()

export async function subscribeToTeamsButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	subscriptions.add(responseStream)
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			() => subscriptions.delete(responseStream),
			{ type: "teams_button_clicked_subscription" },
			responseStream,
		)
	}
}

export async function sendTeamsButtonClickedEvent(): Promise<void> {
	await Promise.all(
		[...subscriptions].map(async (responseStream) => {
			try {
				await responseStream(Empty.create({}), false)
			} catch (error) {
				Logger.error("Error sending teams button clicked event:", error)
				subscriptions.delete(responseStream)
			}
		}),
	)
}
