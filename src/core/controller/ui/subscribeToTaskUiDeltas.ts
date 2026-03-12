import { EmptyRequest } from "@shared/proto/cline/common"
import { TaskUiDeltaEvent } from "@shared/proto/cline/ui"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { TaskUiDelta } from "@/shared/TaskUiDelta"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

const activeTaskUiDeltaSubscriptions = new Set<StreamingResponseHandler<TaskUiDeltaEvent>>()

export type TaskUiDeltaDeliveryStats = {
	payloadBytes: number
	broadcastDurationMs: number
	streamSubscriberCount: number
}

export async function subscribeToTaskUiDeltas(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<TaskUiDeltaEvent>,
	requestId?: string,
): Promise<void> {
	activeTaskUiDeltaSubscriptions.add(responseStream)

	const cleanup = () => {
		activeTaskUiDeltaSubscriptions.delete(responseStream)
	}

	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "task_ui_delta_subscription" }, responseStream)
	}
}

export async function sendTaskUiDelta(delta: TaskUiDelta): Promise<TaskUiDeltaDeliveryStats | undefined> {
	let deltaJson: string
	try {
		deltaJson = JSON.stringify(delta)
	} catch (error) {
		Logger.error("Error serializing task UI delta:", error)
		return undefined
	}

	const payloadBytes = Buffer.byteLength(deltaJson, "utf8")
	telemetryService.captureGrpcResponseSize(payloadBytes, "cline.UiService", "subscribeToTaskUiDeltas")
	const startedAt = performance.now()

	const promises = Array.from(activeTaskUiDeltaSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(TaskUiDeltaEvent.create({ deltaJson }), false)
		} catch (error) {
			Logger.error("Error sending task UI delta:", error)
			activeTaskUiDeltaSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)

	return {
		payloadBytes,
		broadcastDurationMs: Math.max(0, performance.now() - startedAt),
		streamSubscriberCount: activeTaskUiDeltaSubscriptions.size,
	}
}
