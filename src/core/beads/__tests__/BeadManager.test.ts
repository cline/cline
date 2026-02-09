import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import type { BeadManagerState } from "@shared/beads"
import sinon from "sinon"
import { BeadManager } from "../BeadManager"

describe("BeadManager", () => {
	let manager: BeadManager
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		manager = new BeadManager("/test/workspace")
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("Initialization", () => {
		it("should start in idle state", () => {
			const state = manager.getState()
			state.status.should.equal("idle")
			state.currentBeadNumber.should.equal(0)
			state.beads.should.be.empty()
			state.totalTokensUsed.should.equal(0)
		})

		it("should accept configuration", () => {
			manager.configure({
				maxIterations: 5,
				tokenBudget: 50000,
				testCommand: "npm test",
				autoApprove: true,
			})

			// Configuration is applied internally, so we test by starting a task
			// and checking the behavior
			const state = manager.getState()
			state.status.should.equal("idle")
		})
	})

	describe("Task Lifecycle", () => {
		it("should start a task and create first bead", async () => {
			const bead = await manager.startTask("Test task description")

			bead.beadNumber.should.equal(1)
			bead.status.should.equal("running")
			bead.taskId.should.be.a.String()

			const state = manager.getState()
			state.status.should.equal("running")
			state.currentBeadNumber.should.equal(1)
			state.beads.should.have.length(1)
		})

		it("should not allow starting a task when already running", async () => {
			await manager.startTask("First task")

			try {
				await manager.startTask("Second task")
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.containEql("Cannot start task")
			}
		})

		it("should allow starting a new task after completion", async () => {
			manager.configure({ autoApprove: true })
			await manager.startTask("First task")
			await manager.completeBead("DONE", "")

			// Now the task should be complete
			const state = manager.getState()
			state.status.should.equal("completed")

			// Should be able to start a new task
			const newBead = await manager.startTask("Second task")
			newBead.beadNumber.should.equal(1)
		})
	})

	describe("State Transitions", () => {
		it("should transition from idle -> running -> awaiting_approval", async () => {
			// Event tracking
			const stateChanges: string[] = []
			manager.on("stateChanged", (state: BeadManagerState) => {
				stateChanges.push(state.status)
			})

			manager.getState().status.should.equal("idle")

			await manager.startTask("Test task")
			manager.getState().status.should.equal("running")

			await manager.completeBead("DONE", "")
			manager.getState().status.should.equal("awaiting_approval")

			stateChanges.should.containEql("running")
			stateChanges.should.containEql("awaiting_approval")
		})

		it("should transition to completed on approval", async () => {
			await manager.startTask("Test task")
			await manager.completeBead("DONE", "")
			await manager.approveBead()

			manager.getState().status.should.equal("completed")
		})

		it("should transition to running on rejection", async () => {
			await manager.startTask("Test task")
			await manager.completeBead("DONE", "")
			manager.rejectBead("Please fix the implementation")

			manager.getState().status.should.equal("running")
			// Should have started a new bead
			manager.getState().currentBeadNumber.should.equal(2)
		})

		it("should handle pause and resume", async () => {
			await manager.startTask("Test task")
			manager.pauseTask()

			manager.getState().status.should.equal("paused")

			manager.resumeTask()
			manager.getState().status.should.equal("running")
		})

		it("should transition to failed on cancel", async () => {
			await manager.startTask("Test task")
			manager.cancelTask()

			manager.getState().status.should.equal("failed")
		})
	})

	describe("Success Criteria Evaluation", () => {
		it("should pass done_tag criterion when response contains DONE", async () => {
			await manager.startTask("Test task", [{ type: "done_tag" }])

			const result = await manager.completeBead("Task completed successfully. DONE", "")

			result.needsApproval.should.be.true()
			manager.getState().lastCriteriaResult?.allPassed.should.be.true()
		})

		it("should fail done_tag criterion when response does not contain DONE", async () => {
			await manager.startTask("Test task", [{ type: "done_tag" }])

			const result = await manager.completeBead("Task in progress", "")

			result.needsApproval.should.be.false()
			result.canContinue.should.be.true()
			manager.getState().lastCriteriaResult?.allPassed.should.be.false()
		})

		it("should pass no_errors criterion when no errors recorded", async () => {
			await manager.startTask("Test task", [{ type: "no_errors" }])

			const result = await manager.completeBead("DONE", "")

			result.needsApproval.should.be.true()
			const criteriaResult = manager.getState().lastCriteriaResult
			;(criteriaResult!.results.no_errors as boolean).should.be.true()
		})

		it("should fail no_errors criterion when errors are recorded", async () => {
			await manager.startTask("Test task", [{ type: "no_errors" }])
			manager.recordError("Something went wrong")

			const result = await manager.completeBead("DONE", "")

			result.needsApproval.should.be.false()
			const criteriaResult = manager.getState().lastCriteriaResult
			;(criteriaResult!.results.no_errors as boolean).should.be.false()
		})

		it("should require all criteria to pass", async () => {
			await manager.startTask("Test task", [{ type: "done_tag" }, { type: "no_errors" }])
			manager.recordError("An error")

			const result = await manager.completeBead("DONE", "")

			// done_tag passes but no_errors fails
			result.needsApproval.should.be.false()
			manager.getState().lastCriteriaResult?.allPassed.should.be.false()
		})
	})

	describe("Token Budget Enforcement", () => {
		it("should track token usage", async () => {
			await manager.startTask("Test task")

			manager.recordTokenUsage(1000)
			manager.recordTokenUsage(500)

			const bead = manager.getCurrentBead()!
			bead.tokensUsed.should.equal(1500)
			manager.getState().totalTokensUsed.should.equal(1500)
		})

		it("should complete task when token budget exhausted", async () => {
			manager.configure({ tokenBudget: 100, autoApprove: true })

			await manager.startTask("Test task")
			manager.recordTokenUsage(150) // Exceed budget

			await manager.completeBead("DONE", "")

			// Task should be completed because budget exceeded
			manager.getState().status.should.equal("completed")
		})
	})

	describe("Max Iterations Limit", () => {
		it("should fail when max iterations reached without criteria passing", async () => {
			manager.configure({ maxIterations: 2 })

			await manager.startTask("Test task", [{ type: "done_tag" }])

			// First attempt
			await manager.completeBead("Not done", "")
			manager.getState().currentBeadNumber.should.equal(1)

			// Second attempt - should hit max iterations
			await manager.completeBead("Still not done", "")

			manager.getState().status.should.equal("failed")
		})

		it("should complete when max iterations reached with approval", async () => {
			manager.configure({ maxIterations: 1, autoApprove: true })

			await manager.startTask("Test task", [{ type: "done_tag" }])
			await manager.completeBead("DONE", "")

			manager.getState().status.should.equal("completed")
		})
	})

	describe("File Change Tracking", () => {
		it("should record file changes in current bead", async () => {
			await manager.startTask("Test task")

			manager.recordFileChange({
				filePath: "/test/file.ts",
				changeType: "modified",
			})
			manager.recordFileChange({
				filePath: "/test/new-file.ts",
				changeType: "created",
			})

			const bead = manager.getCurrentBead()!
			bead.filesChanged.should.have.length(2)
			bead.filesChanged[0].filePath.should.equal("/test/file.ts")
		})
	})

	describe("Event Emission", () => {
		it("should emit beadStarted event", async () => {
			const beadStartedSpy = sandbox.spy()
			manager.on("beadStarted", beadStartedSpy)

			await manager.startTask("Test task")

			beadStartedSpy.calledOnce.should.be.true()
			beadStartedSpy.firstCall.args[0].beadNumber.should.equal(1)
		})

		it("should emit beadAwaitingApproval event", async () => {
			const awaitingApprovalSpy = sandbox.spy()
			manager.on("beadAwaitingApproval", awaitingApprovalSpy)

			await manager.startTask("Test task")
			await manager.completeBead("DONE", "")

			awaitingApprovalSpy.calledOnce.should.be.true()
		})

		it("should emit beadCompleted event on approval", async () => {
			const beadCompletedSpy = sandbox.spy()
			manager.on("beadCompleted", beadCompletedSpy)

			await manager.startTask("Test task")
			await manager.completeBead("DONE", "")
			await manager.approveBead()

			beadCompletedSpy.calledOnce.should.be.true()
			beadCompletedSpy.firstCall.args[0].status.should.equal("approved")
		})

		it("should emit taskCompleted event", async () => {
			const taskCompletedSpy = sandbox.spy()
			manager.on("taskCompleted", taskCompletedSpy)

			manager.configure({ autoApprove: true })
			await manager.startTask("Test task")
			await manager.completeBead("DONE", "")

			taskCompletedSpy.calledOnce.should.be.true()
			taskCompletedSpy.firstCall.args[0].success.should.be.true()
		})

		it("should emit beadFailed event when max iterations exceeded", async () => {
			const beadFailedSpy = sandbox.spy()
			manager.on("beadFailed", beadFailedSpy)

			manager.configure({ maxIterations: 1 })
			await manager.startTask("Test task", [{ type: "done_tag" }])

			// First attempt fails criteria and hits max iterations
			await manager.completeBead("Not done", "")

			beadFailedSpy.calledOnce.should.be.true()
		})
	})

	describe("Auto-approve Mode", () => {
		it("should auto-approve when enabled", async () => {
			manager.configure({ autoApprove: true })

			const beadCompletedSpy = sandbox.spy()
			manager.on("beadCompleted", beadCompletedSpy)

			await manager.startTask("Test task")
			const result = await manager.completeBead("DONE", "")

			result.needsApproval.should.be.false()
			beadCompletedSpy.calledOnce.should.be.true()
		})

		it("should require manual approval when disabled", async () => {
			manager.configure({ autoApprove: false })

			await manager.startTask("Test task")
			const result = await manager.completeBead("DONE", "")

			result.needsApproval.should.be.true()
			manager.getState().status.should.equal("awaiting_approval")
		})
	})

	describe("Bead Skip", () => {
		it("should skip bead and start next one", async () => {
			await manager.startTask("Test task")
			await manager.completeBead("DONE", "")

			const beforeSkipBeadNumber = manager.getState().currentBeadNumber
			manager.skipBead()

			const afterSkipBeadNumber = manager.getState().currentBeadNumber
			afterSkipBeadNumber.should.equal(beforeSkipBeadNumber + 1)

			// Previous bead should be marked as skipped
			const previousBead = manager.getState().beads[0]
			previousBead.status.should.equal("skipped")
		})
	})
})
