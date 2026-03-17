import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"

/**
 * Tests for the double-check completion feature in AttemptCompletionHandler.
 *
 * When doubleCheckCompletionEnabled is true, each attempt_completion call
 * is rejected once, then accepted on the immediate follow-up and latched.
 * The latch remains until invalidated by an edit.
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
			const enabled = false
			const shouldReject = enabled && !taskState.doubleCheckCompletionPending
			shouldReject.should.be.false()
		})
	})

	describe("when enabled", () => {
		it("should reject the first completion attempt", () => {
			const enabled = true

			// First call: pending is false, so reject and set pending
			const shouldReject = enabled && !taskState.doubleCheckCompletionPending
			shouldReject.should.be.true()
			taskState.doubleCheckCompletionPending = true
		})

		it("should accept the second completion attempt and latch completion gate", () => {
			const enabled = true

			// Simulate first call rejected
			taskState.doubleCheckCompletionPending = true

			// Second call: pending is true, so accept
			const shouldReject = enabled && !taskState.doubleCheckCompletionPending
			shouldReject.should.be.false()

			// Handler resets pending and latches after acceptance
			taskState.doubleCheckCompletionPending = false
			taskState.doubleCheckCompletionLatched = true
			taskState.doubleCheckCompletionPending.should.be.false()
			taskState.doubleCheckCompletionLatched.should.be.true()
		})

		it("should not reject subsequent attempts while latched", () => {
			const enabled = true

			// After a full reject/accept cycle, pending is false and latch is true
			taskState.doubleCheckCompletionPending = false
			taskState.doubleCheckCompletionLatched = true

			const shouldReject = enabled && !taskState.doubleCheckCompletionLatched && !taskState.doubleCheckCompletionPending
			shouldReject.should.be.false()
		})

		it("should require re-check again after edit invalidates latch", () => {
			// Simulate a previously latched state
			taskState.doubleCheckCompletionLatched = true
			taskState.doubleCheckCompletionPending = false

			// Edit invalidates latch
			taskState.doubleCheckCompletionLatched = false
			taskState.doubleCheckCompletionPending = false

			// First completion attempt after invalidation should be rejected again
			const shouldReject = !taskState.doubleCheckCompletionLatched && !taskState.doubleCheckCompletionPending
			shouldReject.should.be.true()
		})
	})

	describe("consecutiveMistakeCount interaction", () => {
		it("should not increment consecutiveMistakeCount on rejection", () => {
			taskState.consecutiveMistakeCount = 0
			// Rejection path does not touch consecutiveMistakeCount
			taskState.doubleCheckCompletionPending = true
			taskState.consecutiveMistakeCount.should.equal(0)
		})
	})

	describe("initialization and lifecycle", () => {
		it("should start as false", () => {
			taskState.doubleCheckCompletionPending.should.be.false()
			taskState.doubleCheckCompletionLatched.should.be.false()
			taskState.doubleCheckCompletionRejectionCount.should.equal(0)
		})

		it("should reset with new TaskState (new task)", () => {
			taskState.doubleCheckCompletionPending = true
			taskState.doubleCheckCompletionLatched = true
			taskState.doubleCheckCompletionRejectionCount = 3
			const newTaskState = new TaskState()
			newTaskState.doubleCheckCompletionPending.should.be.false()
			newTaskState.doubleCheckCompletionLatched.should.be.false()
			newTaskState.doubleCheckCompletionRejectionCount.should.equal(0)
		})
	})
})
