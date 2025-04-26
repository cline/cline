import { TerminalProcess } from "../TerminalProcess"
import { execSync } from "child_process"

describe("TerminalProcess.interpretExitCode", () => {
	it("should handle undefined exit code", () => {
		const result = TerminalProcess.interpretExitCode(undefined)
		expect(result).toEqual({ exitCode: undefined })
	})

	it("should handle normal exit codes (0-127)", () => {
		// Test success exit code (0)
		let result = TerminalProcess.interpretExitCode(0)
		expect(result).toEqual({ exitCode: 0 })

		// Test error exit code (1)
		result = TerminalProcess.interpretExitCode(1)
		expect(result).toEqual({ exitCode: 1 })

		// Test arbitrary exit code within normal range
		result = TerminalProcess.interpretExitCode(42)
		expect(result).toEqual({ exitCode: 42 })

		// Test boundary exit code
		result = TerminalProcess.interpretExitCode(127)
		expect(result).toEqual({ exitCode: 127 })
	})

	it("should handle signal exit codes (128+)", () => {
		// Test SIGINT (Ctrl+C) - 128 + 2 = 130
		const result = TerminalProcess.interpretExitCode(130)
		expect(result).toEqual({
			exitCode: 130,
			signal: 2,
			signalName: "SIGINT",
			coreDumpPossible: false,
		})

		// Test SIGTERM - 128 + 15 = 143
		const resultTerm = TerminalProcess.interpretExitCode(143)
		expect(resultTerm).toEqual({
			exitCode: 143,
			signal: 15,
			signalName: "SIGTERM",
			coreDumpPossible: false,
		})

		// Test SIGSEGV (segmentation fault) - 128 + 11 = 139
		const resultSegv = TerminalProcess.interpretExitCode(139)
		expect(resultSegv).toEqual({
			exitCode: 139,
			signal: 11,
			signalName: "SIGSEGV",
			coreDumpPossible: true,
		})
	})

	it("should identify signals that can produce core dumps", () => {
		// Core dump possible signals: SIGQUIT(3), SIGILL(4), SIGABRT(6), SIGBUS(7), SIGFPE(8), SIGSEGV(11)
		const coreDumpSignals = [3, 4, 6, 7, 8, 11]

		for (const signal of coreDumpSignals) {
			const exitCode = 128 + signal
			const result = TerminalProcess.interpretExitCode(exitCode)
			expect(result.coreDumpPossible).toBe(true)
		}

		// Test a non-core-dump signal
		const nonCoreDumpResult = TerminalProcess.interpretExitCode(128 + 1) // SIGHUP
		expect(nonCoreDumpResult.coreDumpPossible).toBe(false)
	})

	it("should handle unknown signals", () => {
		// Test an exit code for a signal that's not in our mapping
		const result = TerminalProcess.interpretExitCode(128 + 99)
		expect(result).toEqual({
			exitCode: 128 + 99,
			signal: 99,
			signalName: "Unknown Signal (99)",
			coreDumpPossible: false,
		})
	})
})

describe("TerminalProcess.interpretExitCode with real commands", () => {
	it("should correctly interpret exit code 0 from successful command", () => {
		try {
			// Run a command that should succeed
			execSync("echo test", { stdio: "ignore" })
			// If we get here, the command succeeded with exit code 0
			const result = TerminalProcess.interpretExitCode(0)
			expect(result).toEqual({ exitCode: 0 })
		} catch (error: any) {
			// This should not happen for a successful command
			fail("Command should have succeeded: " + error.message)
		}
	})

	it("should correctly interpret exit code 1 from failed command", () => {
		try {
			// Run a command that should fail with exit code 1 or 2
			execSync("ls /nonexistent_directory", { stdio: "ignore" })
			fail("Command should have failed")
		} catch (error: any) {
			// Verify the exit code is what we expect (can be 1 or 2 depending on the system)
			expect(error.status).toBeGreaterThan(0)
			expect(error.status).toBeLessThan(128) // Not a signal
			const result = TerminalProcess.interpretExitCode(error.status)
			expect(result).toEqual({ exitCode: error.status })
		}
	})

	it("should correctly interpret exit code from command with custom exit code", () => {
		try {
			// Run a command that exits with a specific code
			execSync("exit 42", { stdio: "ignore" })
			fail("Command should have exited with code 42")
		} catch (error: any) {
			expect(error.status).toBe(42)
			const result = TerminalProcess.interpretExitCode(error.status)
			expect(result).toEqual({ exitCode: 42 })
		}
	})

	// Test signal interpretation directly without relying on actual process termination
	it("should correctly interpret signal termination codes", () => {
		// Test SIGTERM (signal 15)
		const sigtermExitCode = 128 + 15
		const sigtermResult = TerminalProcess.interpretExitCode(sigtermExitCode)
		expect(sigtermResult.signal).toBe(15)
		expect(sigtermResult.signalName).toBe("SIGTERM")
		expect(sigtermResult.coreDumpPossible).toBe(false)

		// Test SIGSEGV (signal 11)
		const sigsegvExitCode = 128 + 11
		const sigsegvResult = TerminalProcess.interpretExitCode(sigsegvExitCode)
		expect(sigsegvResult.signal).toBe(11)
		expect(sigsegvResult.signalName).toBe("SIGSEGV")
		expect(sigsegvResult.coreDumpPossible).toBe(true)

		// Test SIGINT (signal 2)
		const sigintExitCode = 128 + 2
		const sigintResult = TerminalProcess.interpretExitCode(sigintExitCode)
		expect(sigintResult.signal).toBe(2)
		expect(sigintResult.signalName).toBe("SIGINT")
		expect(sigintResult.coreDumpPossible).toBe(false)
	})
})
