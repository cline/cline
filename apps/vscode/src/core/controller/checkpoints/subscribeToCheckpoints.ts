import { CheckpointEvent, CheckpointSubscriptionRequest } from "@shared/proto/cline/checkpoints"
import { StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

export async function subscribeToCheckpoints(
	_controller: Controller,
	_request: CheckpointSubscriptionRequest,
	_responseStream: StreamingResponseHandler<CheckpointEvent>,
	_requestId?: string,
): Promise<void> {
	return
}
