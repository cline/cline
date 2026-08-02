import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { getAllRefactoringFlags, isRefactoringEnabled, resetRefactoringFlags, setRefactoringFlag } from "../refactoring-flags"

describe("refactoring-flags", () => {
	beforeEach(() => {
		resetRefactoringFlags()
	})

	afterEach(() => {
		resetRefactoringFlags()
	})

	it("defaults: deltaStatePush on, other flags off", () => {
		const flags = getAllRefactoringFlags()
		// deltaStatePush was flipped to the default in the P1 delta-push commit
		// (dependencies fully wired); the rest stay disabled kill-switches.
		expect(flags.deltaStatePush).toBe(true)
		expect(flags.jsonlStorage).toBe(false)
		expect(flags.sseHeartbeat).toBe(false)
	})

	it("reports a single flag", () => {
		expect(isRefactoringEnabled("jsonlStorage")).toBe(false)
		setRefactoringFlag("jsonlStorage", true)
		expect(isRefactoringEnabled("jsonlStorage")).toBe(true)
	})

	it("flags are independent", () => {
		setRefactoringFlag("deltaStatePush", true)
		expect(isRefactoringEnabled("deltaStatePush")).toBe(true)
		expect(isRefactoringEnabled("jsonlStorage")).toBe(false)
		expect(isRefactoringEnabled("sseHeartbeat")).toBe(false)
	})

	it("resetRefactoringFlags restores defaults", () => {
		setRefactoringFlag("deltaStatePush", true)
		setRefactoringFlag("jsonlStorage", true)
		resetRefactoringFlags()
		const flags = getAllRefactoringFlags()
		expect(flags.deltaStatePush).toBe(true)
		expect(flags.jsonlStorage).toBe(false)
	})

	it("environment variables override defaults", () => {
		const origEnv = process.env.CLINE_REFACTORING_FLAGS
		try {
			process.env.CLINE_REFACTORING_FLAGS = "deltaStatePush=true"
			resetRefactoringFlags() // Re-reads env
			expect(isRefactoringEnabled("deltaStatePush")).toBe(true)
			expect(isRefactoringEnabled("jsonlStorage")).toBe(false)
		} finally {
			process.env.CLINE_REFACTORING_FLAGS = origEnv
			resetRefactoringFlags()
		}
	})
})
