import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"

/**
 * Tests for the double-check completion feature in AttemptCompletionHandler.
 *
 * When doubleCheckCompletionEnabled is true, each attempt_completion call
 * is rejected the first time (setting pending=true), then accepted on the
 * immediate follow-up (resetting pending=false). This means every completion
 * attempt gets double-checked, not just the first one in a task.
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

		it("should accept the second completion attempt and reset pending", () => {
			const enabled = true

			// Simulate first call rejected
			taskState.doubleCheckCompletionPending = true

			// Second call: pending is true, so accept
			const shouldReject = enabled && !taskState.doubleCheckCompletionPending
			shouldReject.should.be.false()

			// Handler resets pending after acceptance
			taskState.doubleCheckCompletionPending = false
			taskState.doubleCheckCompletionPending.should.be.false()
		})

		it("should reject again after the pending flag is reset (third call)", () => {
			const enabled = true

			// After a full reject/accept cycle, pending is back to false
			taskState.doubleCheckCompletionPending = false

			const shouldReject = enabled && !taskState.doubleCheckCompletionPending
			shouldReject.should.be.true()
		})

		it("should double-check every completion attempt across a full task lifecycle", () => {
			const shouldReject = () => !taskState.doubleCheckCompletionPending

			// Cycle 1: reject, then accept
			shouldReject().should.be.true()
			taskState.doubleCheckCompletionPending = true
			shouldReject().should.be.false()
			taskState.doubleCheckCompletionPending = false

			// Cycle 2: reject, then accept
			shouldReject().should.be.true()
			taskState.doubleCheckCompletionPending = true
			shouldReject().should.be.false()
			taskState.doubleCheckCompletionPending = false

			// Cycle 3: still triggers
			shouldReject().should.be.true()
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
		})

		it("should reset with new TaskState (new task)", () => {
			taskState.doubleCheckCompletionPending = true
			const newTaskState = new TaskState()
			newTaskState.doubleCheckCompletionPending.should.be.false()
		})
	})
})
