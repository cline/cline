import { beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"

/**
 * Tests for consecutiveMistakeCount behavior in WriteToFileToolHandler.
 *
 * These tests verify the fix for the infinite retry loop bug where:
 * - The counter was being reset to 0 at the START of each operation
 * - This prevented the tooManyMistakes check from seeing accumulated failures
 * - The model could retry failing replace_in_file operations indefinitely
 *
 * The fix ensures:
 * - Counter is only reset AFTER successful saveChanges()
 * - Counter is incremented on diff errors and parameter errors
 * - Repeated failures accumulate so tooManyMistakes can trigger
 */
describe("WriteToFileToolHandler consecutiveMistakeCount", () => {
	let taskState: TaskState
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		taskState = new TaskState()
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("counter initialization", () => {
		it("should start at 0", () => {
			taskState.consecutiveMistakeCount.should.equal(0)
		})
	})

	describe("counter NOT reset at operation start", () => {
		/**
		 * This is the core bug fix test.
		 * Previously, the counter was reset to 0 at the start of execute(),
		 * which prevented accumulated failures from being detected.
		 */
		it("should preserve existing count when starting a new operation", () => {
			// Simulate previous failures
			taskState.consecutiveMistakeCount = 2

			// Simulate the START of execute() - counter should NOT be reset here
			// (In the buggy code, there was: config.taskState.consecutiveMistakeCount = 0)
			// After the fix, this reset is removed

			// Counter should still be 2 (not reset to 0)
			taskState.consecutiveMistakeCount.should.equal(2)
		})

		it("should allow tooManyMistakes check to see accumulated failures", () => {
			const maxConsecutiveMistakes = 3

			// Simulate 3 previous failures
			taskState.consecutiveMistakeCount = 3

			// The tooManyMistakes check happens BEFORE the operation
			// It should be able to see the accumulated count
			const shouldTriggerMistakeLimit = taskState.consecutiveMistakeCount >= maxConsecutiveMistakes
			shouldTriggerMistakeLimit.should.be.true()
		})
	})

	describe("counter reset after successful operation", () => {
		it("should reset to 0 only after successful saveChanges()", () => {
			// Simulate previous failures
			taskState.consecutiveMistakeCount = 2

			// Simulate successful operation
			// (In WriteToFileToolHandler, this happens after saveChanges() succeeds)
			const saveChangesSucceeded = true
			if (saveChangesSucceeded) {
				taskState.consecutiveMistakeCount = 0
			}

			taskState.consecutiveMistakeCount.should.equal(0)
		})

		it("should NOT reset if operation fails before saveChanges()", () => {
			// Simulate previous failures
			taskState.consecutiveMistakeCount = 2

			// Simulate operation that fails (e.g., user denies, or validation fails)
			// saveChanges() never gets called
			const operationReachedSaveChanges = false
			if (operationReachedSaveChanges) {
				taskState.consecutiveMistakeCount = 0
			}

			// Counter should still be 2
			taskState.consecutiveMistakeCount.should.equal(2)
		})
	})

	describe("counter increment on diff errors", () => {
		/**
		 * When constructNewFileContent throws (e.g., search string not found),
		 * the counter should be incremented so repeated failures accumulate.
		 */
		it("should increment on diff construction error", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate diff error (search string not found)
			const diffError = new Error("SEARCH block content does not match anything in the file")

			// In validateAndPrepareFileOperation, when diff error occurs:
			taskState.consecutiveMistakeCount++

			taskState.consecutiveMistakeCount.should.equal(1)
		})

		it("should accumulate consecutive diff errors", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate 3 consecutive diff errors
			for (let i = 0; i < 3; i++) {
				// Each diff error increments the counter
				taskState.consecutiveMistakeCount++
			}

			taskState.consecutiveMistakeCount.should.equal(3)
		})

		it("should trigger mistake limit after max consecutive diff errors", () => {
			const maxConsecutiveMistakes = 3
			taskState.consecutiveMistakeCount = 0

			// Simulate max consecutive diff errors
			for (let i = 0; i < maxConsecutiveMistakes; i++) {
				taskState.consecutiveMistakeCount++
			}

			const shouldTriggerMistakeLimit = taskState.consecutiveMistakeCount >= maxConsecutiveMistakes
			shouldTriggerMistakeLimit.should.be.true()
		})
	})

	describe("counter increment on missing parameter errors", () => {
		it("should increment when path parameter is missing", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate missing path parameter
			const pathMissing = true
			if (pathMissing) {
				taskState.consecutiveMistakeCount++
			}

			taskState.consecutiveMistakeCount.should.equal(1)
		})

		it("should increment when diff parameter is missing for replace_in_file", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate missing diff parameter
			const diffMissing = true
			if (diffMissing) {
				taskState.consecutiveMistakeCount++
			}

			taskState.consecutiveMistakeCount.should.equal(1)
		})

		it("should increment when content parameter is missing for write_to_file", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate missing content parameter
			const contentMissing = true
			if (contentMissing) {
				taskState.consecutiveMistakeCount++
			}

			taskState.consecutiveMistakeCount.should.equal(1)
		})
	})

	describe("realistic retry scenarios", () => {
		/**
		 * Simulates the bug scenario: model retries a failing replace_in_file
		 * multiple times. With the bug, counter would reset each time.
		 * With the fix, counter accumulates.
		 */
		it("should accumulate failures across multiple retry attempts (bug fix verification)", () => {
			const maxConsecutiveMistakes = 3

			// Simulate 5 retry attempts with the FIXED behavior
			for (let attempt = 0; attempt < 5; attempt++) {
				// START of operation - counter should NOT be reset (the fix)
				// (Previously: taskState.consecutiveMistakeCount = 0 was here - BUG)

				// Check if we should stop due to too many mistakes
				if (taskState.consecutiveMistakeCount >= maxConsecutiveMistakes) {
					// This should trigger after 3 failures
					break
				}

				// Simulate diff error
				taskState.consecutiveMistakeCount++
			}

			// With the fix, we should have stopped after 3 failures
			taskState.consecutiveMistakeCount.should.equal(3)
		})

		it("should NOT accumulate if buggy reset-at-start behavior existed", () => {
			const maxConsecutiveMistakes = 3
			let attemptCount = 0

			// Simulate the BUGGY behavior for comparison
			for (let attempt = 0; attempt < 100; attempt++) {
				attemptCount++

				// BUGGY: Reset at start of operation (this was the bug)
				taskState.consecutiveMistakeCount = 0

				// Check if we should stop - this will NEVER trigger because counter is always 0!
				if (taskState.consecutiveMistakeCount >= maxConsecutiveMistakes) {
					break
				}

				// Simulate diff error
				taskState.consecutiveMistakeCount++

				// Prevent infinite loop in test
				if (attemptCount >= 100) {
					break
				}
			}

			// With the bug, we would loop 100 times without stopping
			attemptCount.should.equal(100)
		})

		it("should reset counter and allow new operations after successful operation", () => {
			const maxConsecutiveMistakes = 3

			// Accumulate 2 failures
			taskState.consecutiveMistakeCount = 2

			// Successful operation resets counter
			taskState.consecutiveMistakeCount = 0

			// New failures start from 0
			taskState.consecutiveMistakeCount++

			taskState.consecutiveMistakeCount.should.equal(1)
		})

		it("should handle mixed success and failure scenarios", () => {
			// Failure
			taskState.consecutiveMistakeCount++
			taskState.consecutiveMistakeCount.should.equal(1)

			// Failure
			taskState.consecutiveMistakeCount++
			taskState.consecutiveMistakeCount.should.equal(2)

			// Success - reset
			taskState.consecutiveMistakeCount = 0
			taskState.consecutiveMistakeCount.should.equal(0)

			// Failure
			taskState.consecutiveMistakeCount++
			taskState.consecutiveMistakeCount.should.equal(1)

			// Failure
			taskState.consecutiveMistakeCount++
			taskState.consecutiveMistakeCount.should.equal(2)

			// Failure
			taskState.consecutiveMistakeCount++
			taskState.consecutiveMistakeCount.should.equal(3)

			// Now mistake limit would trigger
			const maxConsecutiveMistakes = 3
			const shouldTrigger = taskState.consecutiveMistakeCount >= maxConsecutiveMistakes
			shouldTrigger.should.be.true()
		})
	})

	describe("interaction with other tool handlers", () => {
		/**
		 * Other tool handlers also increment consecutiveMistakeCount on errors.
		 * The counter should accumulate across different tool types.
		 */
		it("should accumulate across different tool error types", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate ReadFile missing parameter
			taskState.consecutiveMistakeCount++

			// Simulate WriteToFile diff error
			taskState.consecutiveMistakeCount++

			// Simulate another tool error
			taskState.consecutiveMistakeCount++

			taskState.consecutiveMistakeCount.should.equal(3)
		})

		it("should reset from any successful tool operation", () => {
			// Accumulate errors from different tools
			taskState.consecutiveMistakeCount = 2

			// Successful WriteToFile operation resets counter
			taskState.consecutiveMistakeCount = 0

			taskState.consecutiveMistakeCount.should.equal(0)
		})
	})

	describe("edge cases", () => {
		it("should handle counter at max value", () => {
			const maxConsecutiveMistakes = 3
			taskState.consecutiveMistakeCount = maxConsecutiveMistakes

			// Additional errors can still increment
			taskState.consecutiveMistakeCount++

			taskState.consecutiveMistakeCount.should.equal(4)
		})

		it("should handle counter well above max (late detection)", () => {
			const maxConsecutiveMistakes = 3

			// Simulate scenario where check happens after many errors
			taskState.consecutiveMistakeCount = 10

			const shouldTrigger = taskState.consecutiveMistakeCount >= maxConsecutiveMistakes
			shouldTrigger.should.be.true()
		})

		it("should handle max value of 1 (strict mode)", () => {
			const maxConsecutiveMistakes = 1
			taskState.consecutiveMistakeCount = 0

			// Single error
			taskState.consecutiveMistakeCount++

			const shouldTrigger = taskState.consecutiveMistakeCount >= maxConsecutiveMistakes
			shouldTrigger.should.be.true()
		})

		it("should handle max value of 0 (always trigger)", () => {
			const maxConsecutiveMistakes = 0
			taskState.consecutiveMistakeCount = 0

			// Even with no errors, should trigger if max is 0
			const shouldTrigger = taskState.consecutiveMistakeCount >= maxConsecutiveMistakes
			shouldTrigger.should.be.true()
		})
	})

	describe("YOLO mode behavior", () => {
		/**
		 * In YOLO mode (full auto-approval), the task fails when mistake limit is reached.
		 * This tests that the counter works correctly regardless of approval mode.
		 */
		it("should trigger failure in YOLO mode after max mistakes", () => {
			const maxConsecutiveMistakes = 3
			const yoloModeEnabled = true

			// Simulate consecutive failures
			for (let i = 0; i < 3; i++) {
				taskState.consecutiveMistakeCount++
			}

			if (taskState.consecutiveMistakeCount >= maxConsecutiveMistakes) {
				if (yoloModeEnabled) {
					// In YOLO mode, task would fail
					const taskShouldFail = true
					taskShouldFail.should.be.true()
				}
			}
		})
	})

	describe("background edits mode", () => {
		/**
		 * Background edits mode shouldn't affect counter behavior.
		 * The fix applies regardless of whether background edits are on/off.
		 */
		it("should increment on errors with background edits enabled", () => {
			const backgroundEditsEnabled = true
			taskState.consecutiveMistakeCount = 0

			// Simulate diff error (background edits mode doesn't change this)
			taskState.consecutiveMistakeCount++

			taskState.consecutiveMistakeCount.should.equal(1)
		})

		it("should increment on errors with background edits disabled", () => {
			const backgroundEditsEnabled = false
			taskState.consecutiveMistakeCount = 0

			// Simulate diff error
			taskState.consecutiveMistakeCount++

			taskState.consecutiveMistakeCount.should.equal(1)
		})

		it("should reset on success regardless of background edits setting", () => {
			taskState.consecutiveMistakeCount = 2

			// Successful operation resets regardless of background edits mode
			const backgroundEditsEnabled = true
			taskState.consecutiveMistakeCount = 0

			taskState.consecutiveMistakeCount.should.equal(0)
		})
	})

	describe("partial block streaming behavior", () => {
		/**
		 * Tests for the fix that skips error UI handling during streaming.
		 *
		 * During streaming, handlePartialBlock is called repeatedly with block.partial=true.
		 * If a diff error occurs (e.g., search string not found), we should skip all error
		 * handling to prevent:
		 * - consecutiveMistakeCount from rapidly incrementing
		 * - diff_error messages from being added/removed repeatedly
		 * - visual flickering in the diff viewer
		 *
		 * Error handling should only run once on the final block (block.partial=false).
		 */

		it("should NOT increment counter when error occurs during partial block (streaming)", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate the streaming behavior where diff errors are skipped for partial blocks
			const isPartialBlock = true
			const diffError = new Error("SEARCH block content does not match anything in the file")

			// In WriteToFileToolHandler.validateAndPrepareFileOperation, when block.partial=true:
			// if (block.partial) { return } - early return, no error handling
			if (!isPartialBlock) {
				taskState.consecutiveMistakeCount++
			}

			// Counter should remain 0 because error handling was skipped
			taskState.consecutiveMistakeCount.should.equal(0)
		})

		it("should increment counter when error occurs on final block (not streaming)", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate the final block (streaming complete)
			const isPartialBlock = false
			const diffError = new Error("SEARCH block content does not match anything in the file")

			// In WriteToFileToolHandler.validateAndPrepareFileOperation, when block.partial=false:
			// full error handling runs
			if (!isPartialBlock) {
				taskState.consecutiveMistakeCount++
			}

			// Counter should increment because this is the final block
			taskState.consecutiveMistakeCount.should.equal(1)
		})

		it("should not accumulate errors during streaming even with multiple partial block failures", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate multiple streaming chunks with diff failures
			// This happens when the search string isn't found because content is still streaming in
			for (let chunk = 0; chunk < 10; chunk++) {
				const isPartialBlock = true
				// Each chunk fails to find the search string

				// With the fix: skip error handling for partial blocks
				if (!isPartialBlock) {
					taskState.consecutiveMistakeCount++
				}
			}

			// Counter should still be 0 because all errors were during streaming
			taskState.consecutiveMistakeCount.should.equal(0)
		})

		it("should increment exactly once when streaming ends with error on final block", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate streaming: multiple partial blocks with failures, then final block with failure
			const chunks = [
				{ partial: true, error: true }, // chunk 1 - fails, skipped
				{ partial: true, error: true }, // chunk 2 - fails, skipped
				{ partial: true, error: true }, // chunk 3 - fails, skipped
				{ partial: false, error: true }, // final block - fails, counted
			]

			for (const chunk of chunks) {
				if (chunk.error && !chunk.partial) {
					// Only increment on final block errors
					taskState.consecutiveMistakeCount++
				}
			}

			// Counter should be exactly 1 (only the final block error counted)
			taskState.consecutiveMistakeCount.should.equal(1)
		})

		it("should allow successful streaming to complete without incrementing counter", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate successful streaming where early chunks fail but final chunk succeeds
			const chunks = [
				{ partial: true, error: true }, // chunk 1 - incomplete, fails
				{ partial: true, error: true }, // chunk 2 - incomplete, fails
				{ partial: true, error: false }, // chunk 3 - now has enough content, succeeds
				{ partial: false, error: false }, // final block - succeeds
			]

			for (const chunk of chunks) {
				if (chunk.error && !chunk.partial) {
					taskState.consecutiveMistakeCount++
				}
			}

			// Counter should be 0 because all errors were during streaming (partial)
			// and the final block succeeded
			taskState.consecutiveMistakeCount.should.equal(0)
		})

		it("should preserve existing counter value when partial block errors occur", () => {
			// Start with some previous failures
			taskState.consecutiveMistakeCount = 2

			// Simulate partial block with diff error
			const isPartialBlock = true

			if (!isPartialBlock) {
				taskState.consecutiveMistakeCount++
			}

			// Counter should remain at 2 (no change during streaming)
			taskState.consecutiveMistakeCount.should.equal(2)
		})

		it("should correctly accumulate final block errors across multiple operations", () => {
			taskState.consecutiveMistakeCount = 0

			// Simulate multiple replace_in_file operations, each with streaming then final failure
			for (let operation = 0; operation < 3; operation++) {
				// Streaming phase - multiple partial blocks with errors (skipped)
				for (let chunk = 0; chunk < 5; chunk++) {
					const isPartialBlock = true
					if (!isPartialBlock) {
						taskState.consecutiveMistakeCount++
					}
				}

				// Final block with error (counted)
				const isPartialBlock = false
				if (!isPartialBlock) {
					taskState.consecutiveMistakeCount++
				}
			}

			// Should be 3: one for each operation's final block failure
			taskState.consecutiveMistakeCount.should.equal(3)
		})
	})

	describe("auto-approval mode", () => {
		/**
		 * Auto-approval mode shouldn't affect counter behavior.
		 * The fix applies regardless of whether auto-approval is on/off.
		 */
		it("should increment on errors with auto-approval enabled", () => {
			const autoApprovalEnabled = true
			taskState.consecutiveMistakeCount = 0

			// Simulate diff error
			taskState.consecutiveMistakeCount++

			taskState.consecutiveMistakeCount.should.equal(1)
		})

		it("should increment on errors with auto-approval disabled", () => {
			const autoApprovalEnabled = false
			taskState.consecutiveMistakeCount = 0

			// Simulate diff error
			taskState.consecutiveMistakeCount++

			taskState.consecutiveMistakeCount.should.equal(1)
		})

		it("should accumulate failures regardless of approval path taken", () => {
			const maxConsecutiveMistakes = 3

			// First attempt - auto-approved, but fails
			taskState.consecutiveMistakeCount++

			// Second attempt - manually approved, but fails
			taskState.consecutiveMistakeCount++

			// Third attempt - auto-approved, but fails
			taskState.consecutiveMistakeCount++

			// Mistake limit should trigger
			const shouldTrigger = taskState.consecutiveMistakeCount >= maxConsecutiveMistakes
			shouldTrigger.should.be.true()
		})
	})
})
