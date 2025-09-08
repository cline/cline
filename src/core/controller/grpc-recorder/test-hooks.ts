import { getRecorder } from "@/core/controller/grpc-handler"
import { getLatestState } from "@/core/controller/state/getLatestState"
import { GrpcPostRecordHook } from "./types"

export function testHooks(): GrpcPostRecordHook[] {
	return [
		async (entry, controller) => {
			const requestId = entry.requestId

			// Record synthetic "getLatestState" request
			getRecorder().recordRequest(
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

			getRecorder().recordResponse(
				requestId,
				{
					request_id: requestId,
					message: state,
				},
				controller,
			)
		},
	]
}
