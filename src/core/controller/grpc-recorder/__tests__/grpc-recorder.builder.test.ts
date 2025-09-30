import { describe, it } from "mocha"
import "should"
import { GrpcRecorderNoops } from "@/core/controller/grpc-recorder/grpc-recorder"
import { GrpcRecorderBuilder } from "@/core/controller/grpc-recorder/grpc-recorder.builder"
import { LogFileHandler } from "@/core/controller/grpc-recorder/log-file-handler"

describe("GrpcRecorderBuilder", () => {
	describe("when not enabling", () => {
		it("should return GrpcRecorderNoops when enableIf is false", () => {
			const builder = new GrpcRecorderBuilder()
			const recorder = builder.enableIf(false).build()

			recorder.should.be.instanceOf(GrpcRecorderNoops)
		})

		it("should return GrpcRecorderNoops when enableIf is false even with log file handler", () => {
			const builder = new GrpcRecorderBuilder()
			const logFileHandler = new LogFileHandler()
			const recorder = builder.withLogFileHandler(logFileHandler).enableIf(false).build()

			recorder.should.be.instanceOf(GrpcRecorderNoops)
		})
	})

	describe("GrpcRecorderNoops functionality", () => {
		it("should have no-op methods that don't throw errors", () => {
			const recorder = new GrpcRecorderNoops()

			recorder.recordRequest({
				request_id: "test-id",
				service: "TestService",
				method: "testMethod",
				message: {},
				is_streaming: false,
			})

			recorder.recordResponse("test-id", {
				request_id: "test-id",
				message: {},
			})

			recorder.recordError("test-id", "test error")

			const sessionLog = recorder.getSessionLog()
			sessionLog.should.have.property("startTime").which.is.a.String()
			sessionLog.should.have.property("entries").which.is.an.Array()
			sessionLog.entries.should.have.length(0)
		})
	})
})
