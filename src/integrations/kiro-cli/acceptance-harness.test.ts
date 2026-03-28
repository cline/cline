import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"
import { runKiroCliAcceptance } from "./acceptance-harness"

describe("runKiroCliAcceptance", () => {
	it("captures successful runtime output and writes it to the requested output file", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kiro-acceptance-test-"))
		const outputFilePath = path.join(tempDir, "output.txt")

		const result = await runKiroCliAcceptance(
			{
				sessionId: "session-a",
				cwd: tempDir,
				outputFilePath,
				env: { CLINE_RUNTIME_SESSION_ID: "session-a" },
			},
			async function* () {
				yield "READY"
			},
		)

		expect(result.status).to.equal("passed")
		expect(result.outputText).to.equal("READY")
		expect(result.envMarker).to.equal("session-a")
		expect(await fs.readFile(outputFilePath, "utf8")).to.equal("READY")
	})

	it("normalizes runtime failures without throwing", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kiro-acceptance-test-"))

		const result = await runKiroCliAcceptance(
			{
				sessionId: "session-b",
				cwd: tempDir,
			},
			async function* () {
				throw Object.assign(new Error("kiro-cli failed (spawn_failed)."), { failureType: "spawn_failed" })
			},
		)

		expect(result.status).to.equal("failed")
		expect(result.failureType).to.equal("spawn_failed")
		expect(result.errorMessage).to.include("spawn_failed")
	})
})
