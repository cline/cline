import { expect } from "chai"
import sinon from "sinon"

// Define the build-time constant for tests
declare global {
	var __CLINE_VERSION__: string
}
globalThis.__CLINE_VERSION__ = "1.0.0-test"

import { createVersionCommand, getVersion, runVersionCommand } from "../../../src/commands/version.js"
import { createConfig } from "../../../src/core/config.js"
import { createLogger } from "../../../src/core/logger.js"
import type { Logger } from "../../../src/types/logger.js"

describe("Version Command", () => {
	let consoleLogStub: sinon.SinonStub
	let mockLogger: Logger

	beforeEach(() => {
		consoleLogStub = sinon.stub(console, "log")
		mockLogger = {
			debug: sinon.stub(),
			info: sinon.stub(),
			warn: sinon.stub(),
			error: sinon.stub(),
		}
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("getVersion", () => {
		it("should return a semantic version string", () => {
			const version = getVersion()
			expect(version).to.match(/^\d+\.\d+\.\d+/)
		})
	})

	describe("runVersionCommand", () => {
		it("should output version in format 'cline <version>'", () => {
			const config = createConfig()
			runVersionCommand(config, mockLogger)

			expect(consoleLogStub.called).to.be.true
			const output = consoleLogStub.firstCall.args[0]
			expect(output).to.match(/^cline \d+\.\d+\.\d+/)
		})

		it("should log debug message when logger is verbose", () => {
			const config = createConfig({ verbose: true })
			runVersionCommand(config, mockLogger)

			expect((mockLogger.debug as sinon.SinonStub).called).to.be.true
		})
	})

	describe("createVersionCommand", () => {
		it("should create a command named 'version'", () => {
			const config = createConfig()
			const logger = createLogger()
			const cmd = createVersionCommand(config, logger)

			expect(cmd.name()).to.equal("version")
		})

		it("should have a description", () => {
			const config = createConfig()
			const logger = createLogger()
			const cmd = createVersionCommand(config, logger)

			expect(cmd.description()).to.include("version")
		})
	})
})
