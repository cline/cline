import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

const activeConnectorsButtonClickedSubscriptions = new Set<StreamingResponseHandler<Empty>>()

/**
 * Subscribe to connectorsButtonClicked events.
 *
 * Mirrors `subscribeToMcpButtonClicked.ts` — when the user clicks the
 * "External Connectors" title-bar button in the AI-Hydro sidebar, an Empty
 * event is broadcast to every active subscriber. The webview's
 * ExtensionStateContext picks this up and toggles `showConnectors`.
 */
export async function subscribeToConnectorsButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	activeConnectorsButtonClickedSubscriptions.add(responseStream)

	const cleanup = () => {
		activeConnectorsButtonClickedSubscriptions.delete(responseStream)
	}

	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "connectorsButtonClicked_subscription" }, responseStream)
	}
}

export async function sendConnectorsButtonClickedEvent(): Promise<void> {
	const promises = Array.from(activeConnectorsButtonClickedSubscriptions).map(async (responseStream) => {
		try {
			const event = Empty.create({})
			await responseStream(event, false)
		} catch (error) {
			console.error("Error sending connectorsButtonClicked event:", error)
			activeConnectorsButtonClickedSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
