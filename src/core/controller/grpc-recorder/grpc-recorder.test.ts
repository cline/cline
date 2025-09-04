import { GrpcRecorder, IRecorder } from "@core/controller/grpc-recorder/grpc-recorder"
import { expect } from "chai"
import { ExtensionMessage } from "@/shared/ExtensionMessage"
import { GrpcRequest } from "@/shared/WebviewMessage"

describe("grpc-recorder", () => {
	let recorder: IRecorder

	before(async () => {
		recorder = GrpcRecorder.builder().enableIf(true).build()
	})

	describe("GrpcRecorder", () => {
		it("matches multiple request, response and stats", async () => {
			interface UseCase {
				request: GrpcRequest
				response: ExtensionMessage["grpc_response"]
				expectedStatus: string
			}
			const requestResponseUseCases: UseCase[] = [
				{
					request: {
						service: "the-service",
						method: "the-method",
						message: "the-message",
						request_id: "request-id-1",
						is_streaming: false,
					},
					response: {
						request_id: "request-id-1",
						message: "the-message-response",
						error: "",
					},
					expectedStatus: "completed",
				},
				{
					request: {
						service: "streaming-service",
						method: "stream-method",
						message: { data: "streaming-data", count: 42 },
						request_id: "request-id-2",
						is_streaming: true,
					},
					response: {
						request_id: "request-id-2",
						message: { streamData: "chunk-1" },
						error: "",
						is_streaming: true,
						sequence_number: 1,
					},
					expectedStatus: "completed",
				},
				{
					request: {
						service: "another-service",
						method: "another-method",
						message: { complex: { nested: "object", array: [1, 2, 3] } },
						request_id: "request-id-3",
						is_streaming: false,
					},
					response: {
						request_id: "request-id-3",
						message: "",
						error: "Something went wrong",
					},
					expectedStatus: "error",
				},
			]

			const initialExpectedStatus = "pending"

			requestResponseUseCases.forEach((us: UseCase, index: number) => {
				recorder.recordRequest(us.request)

				let sessionLog = recorder.getSessionLog()
				expect(sessionLog.entries).length(index + 1)

				expect(sessionLog.entries[index]).to.include({
					service: us.request.service,
					method: us.request.method,
					isStreaming: us.request.is_streaming,
					requestId: us.request.request_id,
					status: initialExpectedStatus,
				})

				if (us.response) {
					recorder.recordResponse(us.request.request_id, us.response)
				}
				sessionLog = recorder.getSessionLog()

				expect(sessionLog.entries[index].status).equal(us.expectedStatus)
				expect(sessionLog.entries[index].response).to.deep.include({
					error: us.response?.error,
				})
			})

			const sessionLog = recorder.getSessionLog()
			expect(sessionLog.stats).to.include({
				totalRequests: 3,
				pendingRequests: 0,
				completedRequests: 2,
				errorRequests: 1,
			})
		})
	})
})
