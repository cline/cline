import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

const activeMarketplaceButtonClickedSubscriptions = new Set<StreamingResponseHandler<Empty>>()

export async function subscribeToMarketplaceButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	activeMarketplaceButtonClickedSubscriptions.add(responseStream)

	const cleanup = () => {
		activeMarketplaceButtonClickedSubscriptions.delete(responseStream)
	}

	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			cleanup,
			{ type: "marketplaceButtonClicked_subscription" },
			responseStream,
		)
	}
}

export async function sendMarketplaceButtonClickedEvent(): Promise<void> {
	const promises = Array.from(activeMarketplaceButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(Empty.create({}), false)
		} catch (error) {
			Logger.error("Error sending marketplaceButtonClicked event:", error)
			activeMarketplaceButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
