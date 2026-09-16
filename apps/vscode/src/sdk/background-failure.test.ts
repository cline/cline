import { CommandExitError, CommandSpawnError } from "@cline/core"
import { describe, expect, it } from "vitest"
import { describeBackgroundFailure } from "./background-failure"

describe("describeBackgroundFailure", () => {
	it("reports the exit code when the process ran and failed", () => {
		expect(describeBackgroundFailure(new CommandExitError(2, "boom"))).toEqual({ exitCode: 2 })
	})

	it("reports the operating system code when the shell could not be started", () => {
		const cause = Object.assign(new Error("spawn pwsh ENOENT"), { code: "ENOENT" })
		expect(describeBackgroundFailure(new CommandSpawnError(cause))).toEqual({ errorCode: "ENOENT" })
		expect(describeBackgroundFailure(new CommandSpawnError(new Error("no code")))).toEqual({ errorCode: "spawn" })
	})

	it("keeps a vanished working directory apart from a missing shell", () => {
		const cause = Object.assign(new Error("spawn pwsh ENOENT"), { code: "ENOENT" })
		const gone = `${process.cwd()}/definitely-missing-${process.pid}`
		expect(describeBackgroundFailure(new CommandSpawnError(cause, { cwd: gone }))).toEqual({
			errorCode: "ENOENT_CWD",
		})
		expect(describeBackgroundFailure(new CommandSpawnError(cause, { cwd: process.cwd() }))).toEqual({
			errorCode: "ENOENT",
		})
	})

	it("labels aborts and everything else without inventing an exit code", () => {
		expect(describeBackgroundFailure(new Error("Command was aborted"))).toEqual({ errorCode: "aborted" })
		const abort = new Error("x")
		abort.name = "AbortError"
		expect(describeBackgroundFailure(abort)).toEqual({ errorCode: "aborted" })
		expect(describeBackgroundFailure(new Error("Failed to write command input: EPIPE"))).toEqual({
			errorCode: "other",
		})
		expect(describeBackgroundFailure("not an error")).toEqual({ errorCode: "other" })
	})
})
