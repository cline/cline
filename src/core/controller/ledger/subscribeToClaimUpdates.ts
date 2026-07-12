import { EmptyRequest } from "@shared/proto/cline/common"
import type { ClaimUpdate } from "@shared/proto/cline/ledger"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import type { Controller } from ".."

const activeSubscriptions = new Set<StreamingResponseHandler<ClaimUpdate>>()

/**
 * Subscribe to claim updates streamed from the MCP server via
 * LedgerEventWatcher → controller.notifyClaimUpdate().
 */
export async function subscribeToClaimUpdates(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ClaimUpdate>,
	requestId?: string,
): Promise<void> {
	console.log("[subscribeToClaimUpdates] Client subscribed to claim updates", requestId)

	activeSubscriptions.add(responseStream)

	const unsubscribe = controller.subscribeToClaimUpdates(async (update: ClaimUpdate) => {
		if (!activeSubscriptions.has(responseStream)) {
			return
		}
		try {
			await responseStream(update, false)
		} catch (error) {
			console.error("[subscribeToClaimUpdates] Stream error:", error)
			activeSubscriptions.delete(responseStream)
			unsubscribe()
		}
	})

	const cleanup = () => {
		activeSubscriptions.delete(responseStream)
		unsubscribe()
		console.log("[subscribeToClaimUpdates] Cleaned up subscription")
	}

	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "ledger_claim_subscription" }, responseStream)
	}
}
