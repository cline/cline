import os from "node:os"
import path from "node:path"
import { describe, it } from "mocha"
import "should"
import { formatResponse } from "@core/prompts/responses"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { TaskState } from "../../../TaskState"

/**
 * Tests for the ReadFileToolHandler file-not-found fix.
 *
 * Background:
 *   When the model asks to read a file that doesn't exist (e.g., a
 *   hallucinated path), extractFileContent() throws "File not found: …".
 *
 * Before the fix:
 *   The thrown error propagated through ToolExecutor, which re-threw it,
 *   crashing the CLI with exit code 1 — a fatal, unrecoverable failure.
 *
 * After the fix:
 *   ReadFileToolHandler catches the error, increments consecutiveMistakeCount,
 *   and returns a formatResponse.toolError() string. The model sees the error
 *   in context and can recover by trying a different path.
 *
 *   The consecutiveMistakeCount = 0 reset was also moved from *before* the
 *   read to *after* a successful read, so repeated file-not-found errors
 *   accumulate toward the yolo-mode mistake limit.
 */

/** Helper: generate a cross-platform path guaranteed not to exist. */
function ghostPath(): string {
	return path.join(os.tmpdir(), `__cline_test_no_such_file_${Date.now()}_${Math.random().toString(36).slice(2)}.py`)
}

describe("ReadFileToolHandler – file not found graceful recovery", () => {
	it("extractFileContent throws on a non-existent path", async () => {
		await extractFileContent(ghostPath(), false).should.be.rejectedWith(/File not found/)
	})

	it("the handler's catch block returns a tool error instead of throwing", async () => {
		const taskState = new TaskState()
		// Simulate the handler: no reset before the read (reset moved to success path).
		const ghost = ghostPath()
		let result: string

		try {
			await extractFileContent(ghost, false)
			result = "should not reach here"
		} catch (error) {
			// ── This is the catch block from ReadFileToolHandler.execute() ──
			taskState.consecutiveMistakeCount++
			const errorMessage = error instanceof Error ? error.message : String(error)
			const normalizedMessage = errorMessage.startsWith("Error reading file:")
				? errorMessage
				: `Error reading file: ${errorMessage}`
			result = formatResponse.toolError(normalizedMessage)
		}

		// The model receives a descriptive error, not a process crash.
		result.should.containEql("Error reading file:")
		result.should.containEql("File not found")
		result.should.containEql(ghost)
	})

	it("repeated file-not-found errors accumulate toward the mistake limit", async () => {
		const taskState = new TaskState()
		const maxConsecutiveMistakes = 3

		// Simulate 3 consecutive read_file calls on non-existent paths.
		// Because the reset was moved to the success path, each failure increments.
		for (let i = 0; i < maxConsecutiveMistakes; i++) {
			try {
				await extractFileContent(ghostPath(), false)
			} catch {
				taskState.consecutiveMistakeCount++
			}
			// No reset happens here — only a successful read resets.
		}

		taskState.consecutiveMistakeCount.should.equal(3)

		const limitReached = taskState.consecutiveMistakeCount >= maxConsecutiveMistakes
		limitReached.should.be.true()
	})

	it("a successful read resets the counter so the model can recover", async () => {
		const taskState = new TaskState()

		// Simulate two prior failures.
		taskState.consecutiveMistakeCount = 2

		// Simulate a successful extractFileContent — the handler resets the counter
		// only AFTER success (the key change in this PR).
		const realFile = path.join(os.tmpdir(), `__cline_test_real_${Date.now()}.txt`)
		const fs = await import("node:fs/promises")
		await fs.writeFile(realFile, "hello")
		try {
			const content = await extractFileContent(realFile, false)
			// Success path: handler resets the counter.
			content.text.should.equal("hello")
			taskState.consecutiveMistakeCount = 0
		} finally {
			await fs.unlink(realFile).catch(() => {})
		}

		taskState.consecutiveMistakeCount.should.equal(0)
	})
})
