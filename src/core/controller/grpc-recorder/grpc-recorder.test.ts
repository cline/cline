import { GrpcRecorder } from "@core/controller/grpc-recorder/grpc-recorder"
import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, before, describe, it } from "mocha"
import * as os from "os"
import path from "path"

describe("grpc-recorder", () => {
	let recorder: GrpcRecorder
	const tmpDir = path.join(os.tmpdir(), "cline-test-" + Math.random().toString(36).slice(2))

	// weird, we should have beforeAll
	before(() => {
		process.env.DEV_WORKSPACE_FOLDER = tmpDir
		recorder = GrpcRecorder.getInstance()

		expect(recorder.getLogFilePath()).contain("T/cline-test-")
	})

	after(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	afterEach(() => {})

	describe("GrpcRecorder", () => {
		it("matches multiple request, response and stats", async () => {
			recorder.recordRequest({
				service: "the-service",
				method: "the-method",
				message: "the-message",
				request_id: "request-id",
				is_streaming: false,
			})

			let sessionLog = recorder.getSessionLog()

			expect(sessionLog.entries).length(1)

			expect(sessionLog.entries[0]).to.include({
				isStreaming: false,
				method: "the-method",
				service: "the-service",
				requestId: "request-id",
				status: "pending",
			})

			recorder.recordResponse("request-id", {
				request_id: "request-id",
				message: "the-message-response",
				error: "",
			})

			sessionLog = recorder.getSessionLog()

			expect(sessionLog.stats).to.include({
				totalRequests: 1,
				pendingRequests: 0,
				completedRequests: 1,
				errorRequests: 0,
			})

			expect(sessionLog.entries).length(1)

			expect(sessionLog.entries[0].status).equal("completed")
			expect(sessionLog.entries[0].response).to.include({
				error: "",
				message: "the-message-response",
			})
		})
	})
})
