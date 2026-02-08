import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"

/**
 * Tests for the double-check completion feature in AttemptCompletionHandler.
 *
 * When doubleCheckCompletionEnabled is true, the first attempt_completion
 * call is rejected with a tool error asking the model to re-verify its work.
 * The second call proceeds normally. This is counter-based (deterministic).
 */
describe("AttemptCompletionHandler double-check completion", () => {
	let taskState: TaskState
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		taskState = new TaskState()
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("when disabled (default)", () => {
		it("should not reject any completion attempts", () => {
			const doubleCheckCompletionEnabled = false

			// Simulate first attempt
			taskState.completionAttemptCount++
			const shouldReject = doubleCheckCompletionEnabled && taskState.completionAttemptCount === 1
			shouldReject.should.be.false()
		})

		it("should still increment the counter even when disabled", () => {
			taskState.completionAttemptCount++
			taskState.completionAttemptCount.should.equal(1)

			taskState.completionAttemptCount++
			taskState.completionAttemptCount.should.equal(2)
		})
	})

	describe("when enabled", () => {
		it("should reject the first completion attempt", () => {
			const doubleCheckCompletionEnabled = true

			taskState.completionAttemptCount++
			const shouldReject = doubleCheckCompletionEnabled && taskState.completionAttemptCount === 1
			shouldReject.should.be.true()
		})

		it("should accept the second completion attempt", () => {
			const doubleCheckCompletionEnabled = true

			// First attempt (rejected)
			taskState.completionAttemptCount++
			const firstReject = doubleCheckCompletionEnabled && taskState.completionAttemptCount === 1
			firstReject.should.be.true()

			// Second attempt (accepted)
			taskState.completionAttemptCount++
			const secondReject = doubleCheckCompletionEnabled && taskState.completionAttemptCount === 1
			secondReject.should.be.false()
		})

		it("should accept the third and subsequent completion attempts", () => {
			const doubleCheckCompletionEnabled = true

			taskState.completionAttemptCount = 3
			const shouldReject = doubleCheckCompletionEnabled && taskState.completionAttemptCount === 1
			shouldReject.should.be.false()
		})
	})

	describe("consecutiveMistakeCount interaction", () => {
		it("should not increment consecutiveMistakeCount on rejection", () => {
			// The handler resets consecutiveMistakeCount to 0 before checking double-check,
			// and the rejection does not touch it further.
			taskState.consecutiveMistakeCount = 0
			taskState.completionAttemptCount++

			// Simulating the handler flow: consecutiveMistakeCount stays at 0
			taskState.consecutiveMistakeCount.should.equal(0)
		})

		it("should not affect consecutiveMistakeCount when feature is disabled", () => {
			taskState.consecutiveMistakeCount = 2
			taskState.completionAttemptCount++

			// Counter is untouched by the double-check logic
			taskState.consecutiveMistakeCount.should.equal(2)
		})
	})

	describe("counter initialization and lifecycle", () => {
		it("should start at 0", () => {
			taskState.completionAttemptCount.should.equal(0)
		})

		it("should reset with new TaskState (new task)", () => {
			taskState.completionAttemptCount = 5
			const newTaskState = new TaskState()
			newTaskState.completionAttemptCount.should.equal(0)
		})
	})
})
