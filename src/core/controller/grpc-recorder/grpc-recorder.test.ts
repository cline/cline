import { GrpcRecorder, Recorder } from "@core/controller/grpc-recorder/grpc-recorder"
import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, before, describe, it } from "mocha"
import * as os from "os"
import path from "path"
import { ExtensionMessage } from "@/shared/ExtensionMessage"
import { GrpcRequest } from "@/shared/WebviewMessage"

describe("grpc-recorder", () => {
	let originalEnv: NodeJS.ProcessEnv
	let recorder: Recorder
	const tmpDir = path.join(os.tmpdir(), "cline-test-" + Math.random().toString(36).slice(2))

	// weird, we should have beforeAll
	before(async () => {
		originalEnv = { ...process.env }

		// WIP: we should avoid doing this, this can affect other tests
		process.env.DEV_WORKSPACE_FOLDER = tmpDir
		process.env.GRPC_RECORDER_ENABLED = "true"

		// Ensure the directory structure exists
		const testsDir = path.join(tmpDir, "tests", "specs")
		await fs.mkdir(testsDir, { recursive: true })

		recorder = GrpcRecorder.getInstance()
		expect(recorder.getLogFilePath()).contain("T/cline-test-")
		expect(recorder.getLogFilePath()).contain("grpc-recorded-session-")
	})

	after(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	afterEach(() => {
		process.env = { ...originalEnv }
	})

	// WIP: refactor test
	describe("GrpcRecorder", () => {
		it("check whether is enabled or not", async () => {})

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

				recorder.recordResponse(us.request.request_id, us.response)
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

			await recorder.flushLog()

			const logFilePath = recorder.getLogFilePath()
			let fileExists = false
			try {
				await fs.access(logFilePath)
				fileExists = true
			} catch (error) {
				// WIP: maybe fail the test here?
			}
			expect(fileExists).to.be.true

			const fileContent = await fs.readFile(logFilePath, "utf8")
			const parsedContent = JSON.parse(fileContent)

			expect(parsedContent.entries).to.be.length(3)
		})
	})
})
