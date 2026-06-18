import { expect } from "chai"
import { beforeAll, describe, it } from "bun:test"
import { LogFileHandler } from "@/core/controller/grpc-recorder/log-file-handler"

describe("log-file-handler", () => {
	let logHandler: LogFileHandler

	beforeAll(async () => {
		logHandler = new LogFileHandler()
		expect(logHandler.getFilePath()).not.empty
	})

	describe("LogFileHandler", () => {
		it("returns file name with timestamp when env var not set", () => {
			const result = logHandler.getFileName()
			expect(result).to.contains("grpc_recorded_session")
		})
	})
})
