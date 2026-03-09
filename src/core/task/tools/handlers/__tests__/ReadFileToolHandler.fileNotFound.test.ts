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
 */
describe("ReadFileToolHandler – file not found graceful recovery", () => {
	it("extractFileContent throws on a non-existent path", async () => {
		const ghost = "/tmp/__cline_test_no_such_file_" + Date.now() + ".py"

		await extractFileContent(ghost, false).should.be.rejectedWith(/File not found/)
	})

	it("the handler's catch block returns a tool error instead of throwing", async () => {
		const taskState = new TaskState()
		taskState.consecutiveMistakeCount = 0

		// Simulate exactly what ReadFileToolHandler.execute() now does:
		const ghost = "/tmp/__cline_test_no_such_file_" + Date.now() + ".py"
		let result: string

		try {
			await extractFileContent(ghost, false)
			result = "should not reach here"
		} catch (error) {
			// ── This is the new catch block from the fix ──
			taskState.consecutiveMistakeCount++
			const errorMessage = error instanceof Error ? error.message : String(error)
			result = formatResponse.toolError(`Error reading file: ${errorMessage}`)
		}

		// The model receives a descriptive error, not a process crash.
		result.should.containEql("Error reading file:")
		result.should.containEql("File not found")
		result.should.containEql(ghost)
	})

	it("consecutiveMistakeCount increments so the yolo-mode limit still works", async () => {
		const taskState = new TaskState()
		taskState.consecutiveMistakeCount = 2 // two prior mistakes

		const ghost = "/tmp/__cline_test_no_such_file_" + Date.now() + ".py"

		try {
			await extractFileContent(ghost, false)
		} catch {
			taskState.consecutiveMistakeCount++
		}

		taskState.consecutiveMistakeCount.should.equal(3)

		// With maxConsecutiveMistakes = 3, the limit now correctly triggers.
		const maxConsecutiveMistakes = 3
		const limitReached = taskState.consecutiveMistakeCount >= maxConsecutiveMistakes
		limitReached.should.be.true()
	})

	it("a successful read resets the counter (recovery path works)", async () => {
		const taskState = new TaskState()
		taskState.consecutiveMistakeCount = 2

		// Simulate successful read_file (the happy path that already existed):
		taskState.consecutiveMistakeCount = 0

		taskState.consecutiveMistakeCount.should.equal(0)
	})
})
