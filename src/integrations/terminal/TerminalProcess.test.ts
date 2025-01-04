import { describe, it, expect } from "vitest"
import { TerminalProcess } from "./TerminalProcess"

describe("TerminalProcess Method Existence", () => {
	let terminalProcess: TerminalProcess

	beforeEach(() => {
		terminalProcess = new TerminalProcess()
	})

	it("should have run method", () => {
		expect(terminalProcess.run).toBeDefined()
		expect(typeof terminalProcess.run).toBe("function")
	})

	it("should have continue method", () => {
		expect(terminalProcess.continue).toBeDefined()
		expect(typeof terminalProcess.continue).toBe("function")
	})

	it("should have getUnretrievedOutput method", () => {
		expect(terminalProcess.getUnretrievedOutput).toBeDefined()
		expect(typeof terminalProcess.getUnretrievedOutput).toBe("function")
	})

	it("should have on method", () => {
		expect(terminalProcess.on).toBeDefined()
		expect(typeof terminalProcess.on).toBe("function")
	})

	it("should have once method", () => {
		expect(terminalProcess.once).toBeDefined()
		expect(typeof terminalProcess.once).toBe("function")
	})

	it("should have emit method", () => {
		expect(terminalProcess.emit).toBeDefined()
		expect(typeof terminalProcess.emit).toBe("function")
	})

	it("should have isHot property", () => {
		expect(terminalProcess).toHaveProperty("isHot")
	})

	it("should have waitForShellIntegration property", () => {
		expect(terminalProcess).toHaveProperty("waitForShellIntegration")
	})
})
