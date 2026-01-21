import { beforeEach, describe, it } from "mocha"
import "should"
import { TaskState } from "../TaskState"

describe("TaskState", () => {
	describe("errorPushedForCallIds", () => {
		let taskState: TaskState

		beforeEach(() => {
			taskState = new TaskState()
		})

		it("should initialize as empty Set", () => {
			taskState.errorPushedForCallIds.should.be.instanceOf(Set)
			taskState.errorPushedForCallIds.size.should.equal(0)
		})

		it("should track call_ids that have had errors pushed", () => {
			const callId = "call_abc123"

			// Initially not present
			taskState.errorPushedForCallIds.has(callId).should.be.false()

			// Add call_id
			taskState.errorPushedForCallIds.add(callId)

			// Now present
			taskState.errorPushedForCallIds.has(callId).should.be.true()
		})

		it("should track multiple call_ids independently", () => {
			const callId1 = "call_abc123"
			const callId2 = "call_def456"
			const callId3 = "call_ghi789"

			// Add first two
			taskState.errorPushedForCallIds.add(callId1)
			taskState.errorPushedForCallIds.add(callId2)

			// Check tracking
			taskState.errorPushedForCallIds.has(callId1).should.be.true()
			taskState.errorPushedForCallIds.has(callId2).should.be.true()
			taskState.errorPushedForCallIds.has(callId3).should.be.false()
		})

		it("should clear all tracked call_ids", () => {
			// Add multiple call_ids
			taskState.errorPushedForCallIds.add("call_1")
			taskState.errorPushedForCallIds.add("call_2")
			taskState.errorPushedForCallIds.add("call_3")
			taskState.errorPushedForCallIds.size.should.equal(3)

			// Clear
			taskState.errorPushedForCallIds.clear()

			// Should be empty
			taskState.errorPushedForCallIds.size.should.equal(0)
			taskState.errorPushedForCallIds.has("call_1").should.be.false()
		})

		it("should not add duplicate call_ids (Set behavior)", () => {
			const callId = "call_abc123"

			taskState.errorPushedForCallIds.add(callId)
			taskState.errorPushedForCallIds.add(callId)
			taskState.errorPushedForCallIds.add(callId)

			// Still only one entry
			taskState.errorPushedForCallIds.size.should.equal(1)
		})
	})

	describe("duplicate diff error prevention logic", () => {
		let taskState: TaskState

		beforeEach(() => {
			taskState = new TaskState()
		})

		/**
		 * Simulates the duplicate check logic from WriteToFileToolHandler.
		 * This tests the core logic that prevents duplicate error messages
		 * when parallel tool calling is enabled.
		 */
		function shouldSkipDuplicateError(callId: string | undefined): boolean {
			const id = callId || ""
			if (id && taskState.errorPushedForCallIds.has(id)) {
				return true
			}
			return false
		}

		function markErrorPushed(callId: string | undefined): void {
			const id = callId || ""
			if (id) {
				taskState.errorPushedForCallIds.add(id)
			}
		}

		it("should not skip first error for a call_id", () => {
			const callId = "call_abc123"

			shouldSkipDuplicateError(callId).should.be.false()
		})

		it("should skip subsequent errors for same call_id", () => {
			const callId = "call_abc123"

			// First call - not skipped
			shouldSkipDuplicateError(callId).should.be.false()
			markErrorPushed(callId)

			// Second call - should skip
			shouldSkipDuplicateError(callId).should.be.true()

			// Third call - still skipped
			shouldSkipDuplicateError(callId).should.be.true()
		})

		it("should allow different call_ids to each have their error", () => {
			const callId1 = "call_tool1"
			const callId2 = "call_tool2"

			// First tool error
			shouldSkipDuplicateError(callId1).should.be.false()
			markErrorPushed(callId1)

			// Second tool error (different call_id) - should NOT skip
			shouldSkipDuplicateError(callId2).should.be.false()
			markErrorPushed(callId2)

			// But both should now skip on retry
			shouldSkipDuplicateError(callId1).should.be.true()
			shouldSkipDuplicateError(callId2).should.be.true()
		})

		it("should not skip when call_id is empty (XML tools fallback)", () => {
			// Empty call_id (typical for XML-based tools)
			shouldSkipDuplicateError("").should.be.false()
			markErrorPushed("")

			// Still doesn't skip because empty string is falsy
			shouldSkipDuplicateError("").should.be.false()
		})

		it("should not skip when call_id is undefined", () => {
			shouldSkipDuplicateError(undefined).should.be.false()
			markErrorPushed(undefined)

			// Still doesn't skip
			shouldSkipDuplicateError(undefined).should.be.false()
		})

		it("should reset tracking between API requests (clear)", () => {
			const callId = "call_abc123"

			// Mark error pushed
			markErrorPushed(callId)
			shouldSkipDuplicateError(callId).should.be.true()

			// Simulate reset between API requests
			taskState.errorPushedForCallIds.clear()

			// Same call_id should not skip after reset
			shouldSkipDuplicateError(callId).should.be.false()
		})

		it("should handle rapid streaming chunks (same call_id repeated)", () => {
			const callId = "call_streaming"

			// Simulate 238 streaming chunks (as seen in the bug)
			const results: boolean[] = []

			for (let i = 0; i < 238; i++) {
				const shouldSkip = shouldSkipDuplicateError(callId)
				results.push(shouldSkip)

				if (!shouldSkip) {
					markErrorPushed(callId)
				}
			}

			// First should not skip, rest should skip
			results[0].should.be.false()
			results
				.slice(1)
				.every((r) => r)
				.should.be.true()

			// Should have only added one entry
			taskState.errorPushedForCallIds.size.should.equal(1)
		})
	})
})
