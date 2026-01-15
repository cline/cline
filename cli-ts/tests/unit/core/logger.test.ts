import { expect } from "chai"
import sinon from "sinon"
import { ConsoleLogger, createLogger } from "../../../src/core/logger.js"

describe("Logger", () => {
	let consoleDebugStub: sinon.SinonStub
	let consoleInfoStub: sinon.SinonStub
	let consoleWarnStub: sinon.SinonStub
	let consoleErrorStub: sinon.SinonStub

	beforeEach(() => {
		consoleDebugStub = sinon.stub(console, "debug")
		consoleInfoStub = sinon.stub(console, "info")
		consoleWarnStub = sinon.stub(console, "warn")
		consoleErrorStub = sinon.stub(console, "error")
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("ConsoleLogger", () => {
		describe("with verbose=false", () => {
			it("should not output debug messages", () => {
				const logger = new ConsoleLogger(false)
				logger.debug("test debug message")
				expect(consoleDebugStub.called).to.be.false
			})

			it("should output info messages", () => {
				const logger = new ConsoleLogger(false)
				logger.info("test info message")
				expect(consoleInfoStub.called).to.be.true
			})

			it("should output warn messages", () => {
				const logger = new ConsoleLogger(false)
				logger.warn("test warn message")
				expect(consoleWarnStub.called).to.be.true
			})

			it("should output error messages", () => {
				const logger = new ConsoleLogger(false)
				logger.error("test error message")
				expect(consoleErrorStub.called).to.be.true
			})
		})

		describe("with verbose=true", () => {
			it("should output debug messages", () => {
				const logger = new ConsoleLogger(true)
				logger.debug("test debug message")
				expect(consoleDebugStub.called).to.be.true
			})

			it("should include timestamp and level in formatted message", () => {
				const logger = new ConsoleLogger(true)
				logger.debug("test message")

				const call = consoleDebugStub.firstCall
				const formattedMessage = call.args[0]

				// Check message contains timestamp pattern and level
				expect(formattedMessage).to.match(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
				expect(formattedMessage).to.include("[DEBUG]")
				expect(formattedMessage).to.include("test message")
			})
		})
	})

	describe("createLogger", () => {
		it("should create a logger with verbose=false by default", () => {
			const logger = createLogger()
			logger.debug("test")
			expect(consoleDebugStub.called).to.be.false
		})

		it("should create a verbose logger when verbose=true", () => {
			const logger = createLogger(true)
			logger.debug("test")
			expect(consoleDebugStub.called).to.be.true
		})
	})
})
