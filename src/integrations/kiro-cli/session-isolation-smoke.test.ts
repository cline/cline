import { expect } from "chai"
import { describe, it } from "mocha"
import { runLinuxAarch64KiroCliIsolationSmoke } from "./session-isolation-smoke"

describe("runLinuxAarch64KiroCliIsolationSmoke", () => {
	it("reports isolation checks using separate session metadata and output captures", async () => {
		const result = await runLinuxAarch64KiroCliIsolationSmoke({
			runner: async (request) => ({
				sessionId: request.sessionId,
				status: request.sessionId === "session-b" ? "failed" : "passed",
				cwd: request.cwd,
				envMarker: request.env?.CLINE_RUNTIME_SESSION_ID,
				command: request.path?.trim() || "kiro-cli",
				durationMs: 1,
				outputText: request.sessionId,
				outputFilePath: request.outputFilePath,
				failureType: request.sessionId === "session-b" ? "spawn_failed" : undefined,
				errorMessage: request.sessionId === "session-b" ? "missing binary" : undefined,
			}),
		})

		expect(result.passed).to.equal(true)
		expect(result.checks.every((check) => check.passed)).to.equal(true)
		expect(result.sessionA.status).to.equal("passed")
		expect(result.sessionB.status).to.equal("failed")
	})
})
