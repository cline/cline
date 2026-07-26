import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { LocalDiagnosticLogger } from "./local-diagnostic-logger"

describe("LocalDiagnosticLogger", () => {
	let directory = ""

	afterEach(async () => {
		if (directory) await rm(directory, { recursive: true, force: true })
	})

	it("redacts secrets and content before serialization and rotates bounded files", async () => {
		directory = await mkdtemp(join(tmpdir(), "bedrock-coder-local-diagnostics-"))
		const logger = new LocalDiagnosticLogger(directory, 500)
		await logger.initialize()
		logger.record({
			name: "bedrock-request",
			category: "bedrock",
			details: {
				accessKeyId: "AKIA1234567890ABCDEF",
				authorization: "Bearer extremely-secret-value",
				prompt: "known prompt text",
				sourceContent: "known file contents",
				requestId: "request-123",
			},
		})
		await logger.flush()
		const redacted = await readFile(logger.currentPath, "utf8")
		expect(redacted).not.toContain("AKIA1234567890ABCDEF")
		expect(redacted).not.toContain("extremely-secret-value")
		expect(redacted).not.toContain("known prompt text")
		expect(redacted).not.toContain("known file contents")
		expect(redacted).toContain("request-123")

		for (let index = 0; index < 20; index += 1) {
			logger.record({
				name: "rotation-test",
				category: "run",
				runId: `run-${index}`,
				details: { status: "completed" },
			})
		}
		await logger.flush()

		const combined = `${await readFile(logger.previousPath, "utf8")}${await readFile(logger.currentPath, "utf8")}`
		expect(combined).not.toContain("AKIA1234567890ABCDEF")
		expect(combined).not.toContain("extremely-secret-value")
		expect(combined).not.toContain("known prompt text")
		expect(combined).not.toContain("known file contents")
		expect((await readFile(logger.currentPath)).byteLength).toBeLessThanOrEqual(700)
		await logger.dispose()
	})
})
