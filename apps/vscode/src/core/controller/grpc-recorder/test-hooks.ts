import { Controller } from "@/core/controller"
import { GrpcRecorderBuilder } from "@/core/controller/grpc-recorder/grpc-recorder.builder"
import { GrpcPostRecordHook } from "@/core/controller/grpc-recorder/types"
import { getLatestState } from "@/core/controller/state/getLatestState"

// Add 50ms delay by default to ensure we get the latest state
const TEST_HOOK_LATEST_STATE_DELAY = 50

export function testHooks(controller: Controller): GrpcPostRecordHook[] {
	return [
		async (entry) => {
			GrpcRecorderBuilder.getRecorder(controller).cleanupSyntheticEntries()

			await new Promise((resolve) => setTimeout(resolve, TEST_HOOK_LATEST_STATE_DELAY))

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
