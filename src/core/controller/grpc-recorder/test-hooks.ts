import { getLatestState } from "@/core/controller/state/getLatestState"
import { Controller } from ".."
import { GrpcRecorderBuilder } from "./grpc-recorder.builder"
import { GrpcPostRecordHook } from "./types"

export function testHooks(controller: Controller): GrpcPostRecordHook[] {
	return [
		async (entry) => {
			const requestId = entry.requestId

			// Record synthetic "getLatestState" request
			GrpcRecorderBuilder.getRecorder(controller).recordRequest(
				{
					service: "cline.StateService",
					method: "getLatestState",
					message: {},
					request_id: requestId,
					is_streaming: false,
				},
				true,
			)

			const state = await getLatestState(controller, {})

			GrpcRecorderBuilder.getRecorder(controller).recordResponse(requestId, {
				request_id: requestId,
				message: state,
			})
		},
	]
}
