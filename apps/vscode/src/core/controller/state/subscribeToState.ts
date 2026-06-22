import { State } from "@shared/proto/cline/state"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/cline/common"
import { StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

export async function subscribeToState(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<State>,
	_requestId?: string,
): Promise<void> {
	return
}

export async function sendStateUpdate(_state: ExtensionState): Promise<void> {
	return
}
