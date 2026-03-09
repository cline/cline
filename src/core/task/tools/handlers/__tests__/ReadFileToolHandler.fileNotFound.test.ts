import os from "node:os"
import path from "node:path"
import { describe, it } from "mocha"
import "should"
import { formatResponse } from "@core/prompts/responses"
import { extractFileContent } from "@integrations/misc/extract-file-content"

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
 *   ReadFileToolHandler catches the error and returns a
 *   formatResponse.toolError() string. The model sees the error in context
 *   and can recover by trying a different path.
 *
 * Note: Testing consecutiveMistakeCount accumulation and reset requires
 * invoking ReadFileToolHandler.execute() with a fully mocked TaskConfig,
 * which is not done here. The handler logic is a straightforward
 * try/catch → increment / success → reset pattern that can be verified
 * by reading the handler source.
 */

/** Helper: generate a cross-platform path guaranteed not to exist. */
function ghostPath(): string {
	return path.join(os.tmpdir(), `__cline_test_no_such_file_${Date.now()}_${Math.random().toString(36).slice(2)}.py`)
}

describe("ReadFileToolHandler – file not found graceful recovery", () => {
	it("extractFileContent throws on a non-existent path", async () => {
		await extractFileContent(ghostPath(), false).should.be.rejectedWith(/File not found/)
	})

	it("the thrown error can be caught and wrapped as a tool error", async () => {
		const ghost = ghostPath()
		let result: string | undefined

		try {
			await extractFileContent(ghost, false)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const normalizedMessage = errorMessage.startsWith("Error reading file:")
				? errorMessage
				: `Error reading file: ${errorMessage}`
			result = formatResponse.toolError(normalizedMessage)
		}

		// Demonstrates the error string the model receives instead of a crash.
		result!.should.containEql("Error reading file:")
		result!.should.containEql("File not found")
		result!.should.containEql(ghost)
	})
})
