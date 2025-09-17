import { GrpcRecorder, IRecorder } from "@core/controller/grpc-recorder/grpc-recorder"
import { expect } from "chai"
import { ExtensionMessage } from "@/shared/ExtensionMessage"
import { GrpcRequest } from "@/shared/WebviewMessage"

describe("grpc-recorder", () => {
	let recorder: IRecorder

	before(async () => {
		recorder = GrpcRecorder.builder()
			.withFilters((req: GrpcRequest) => req.service === "the-unwanted-service")
			.enableIf(true)
			.build()
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
				expect(sessionLog.entries).length(index + 1, `unexpected request_id: ${us.request.request_id}`)

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

			recorder.recordRequest({
				service: "the-unwanted-service",
				method: "the-method",
				message: "the-message",
				request_id: "request-id-1",
				is_streaming: false,
			})

			expect(sessionLog.entries).length(3)
		})

		it("using default filtering should filter out unwanted requests", async () => {
			const customRecorder = GrpcRecorder.builder()
				.withFilters(
					(req) => req.is_streaming,
					(req) => ["cline.UiService", "cline.McpService", "cline.WebService"].includes(req.service),
				)
				.enableIf(true)
				.build()
			const unwantedServices = ["cline.UiService", "cline.McpService", "cline.WebService"]
			unwantedServices.forEach((us) => {
				customRecorder.recordRequest({
					service: us,
					method: "the-method",
					message: "the-message",
					request_id: "request-id-1",
					is_streaming: false,
				})
			})
			let sessionLog = customRecorder.getSessionLog()
			expect(sessionLog.entries).length(0)
			customRecorder.recordRequest({
				service: "streaming-request",
				method: "the-method",
				message: "the-message",
				request_id: "request-id-1",
				is_streaming: true,
			})
			sessionLog = customRecorder.getSessionLog()
			expect(sessionLog.entries).length(0)
		})

		it("cleanupSyntheticEntries removes synthetic entries from session log", async () => {
			const testRecorder = GrpcRecorder.builder().enableIf(true).build()

			// Add regular request
			testRecorder.recordRequest({
				service: "regular-service",
				method: "regular-method",
				message: "regular-message",
				request_id: "regular-id",
				is_streaming: false,
			})

			// Add synthetic request
			testRecorder.recordRequest(
				{
					service: "synthetic-service",
					method: "synthetic-method",
					message: "synthetic-message",
					request_id: "synthetic-id",
					is_streaming: false,
				},
				true, // synthetic = true
			)

			let sessionLog = testRecorder.getSessionLog()
			expect(sessionLog.entries).length(2)

			testRecorder.cleanupSyntheticEntries()

			sessionLog = testRecorder.getSessionLog()
			expect(sessionLog.entries).length(1)
			expect(sessionLog.entries[0].requestId).equal("regular-id")
		})

		it("recordResponse executes post-record hooks", async () => {
			let hookExecuted = false
			let hookEntry: any = null

			const mockHook = async (entry: any) => {
				hookExecuted = true
				hookEntry = entry
			}

			const testRecorder = GrpcRecorder.builder().withPostRecordHooks(mockHook).enableIf(true).build()

			testRecorder.recordRequest({
				service: "test-service",
				method: "test-method",
				message: "test-message",
				request_id: "test-id",
				is_streaming: false,
			})

			testRecorder.recordResponse("test-id", {
				request_id: "test-id",
				message: "response-message",
				error: "",
			})

			expect(hookExecuted).to.be.true
			expect(hookEntry).to.not.be.null
			expect(hookEntry.requestId).equal("test-id")
		})
	})
})
