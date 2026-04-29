import { ClineMessage } from "@shared/ExtensionMessage"
import { expect } from "chai"
import { DoubleBufferManager } from "../DoubleBufferManager"

// Minimal mock for ApiHandler — only getModel().info.contextWindow is used
function createMockApi(contextWindow: number) {
	return {
		getModel: () => ({ id: "test-model", info: { contextWindow } }),
	} as any
}

function createMockMessagesWithTokens(totalTokens: number): ClineMessage[] {
	return [
		{
			ts: Date.now(),
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({
				tokensIn: totalTokens,
				tokensOut: 0,
				cacheWrites: 0,
				cacheReads: 0,
			}),
		},
	]
}

describe("DoubleBufferManager", () => {
	let manager: DoubleBufferManager

	beforeEach(() => {
		manager = new DoubleBufferManager(0.6, 0.85)
	})

	describe("initial state", () => {
		it("starts in normal phase", () => {
			const state = manager.getState()
			expect(state.phase).to.equal("normal")
			expect(state.checkpointSummary).to.be.null
			expect(state.generation).to.equal(0)
		})
	})

	describe("phase transitions", () => {
		it("beginCheckpoint transitions to checkpoint_pending", () => {
			manager.beginCheckpoint(10)
			expect(manager.getState().phase).to.equal("checkpoint_pending")
			expect(manager.getState().checkpointMessageIndex).to.equal(10)
		})

		it("finishCheckpoint transitions to concurrent", () => {
			manager.beginCheckpoint(10)
			manager.finishCheckpoint("Summary of conversation")
			const state = manager.getState()
			expect(state.phase).to.equal("concurrent")
			expect(state.checkpointSummary).to.equal("Summary of conversation")
			expect(state.generation).to.equal(1)
		})

		it("completeSwap resets to normal and returns summary", () => {
			manager.beginCheckpoint(10)
			manager.finishCheckpoint("Summary")
			const summary = manager.completeSwap()
			expect(summary).to.equal("Summary")
			const state = manager.getState()
			expect(state.phase).to.equal("normal")
			expect(state.checkpointSummary).to.be.null
			expect(state.generation).to.equal(1)
		})

		it("full lifecycle: normal -> checkpoint -> concurrent -> swap -> normal", () => {
			expect(manager.getState().phase).to.equal("normal")

			manager.beginCheckpoint(5)
			expect(manager.getState().phase).to.equal("checkpoint_pending")

			manager.finishCheckpoint("Checkpoint summary")
			expect(manager.getState().phase).to.equal("concurrent")
			expect(manager.getState().generation).to.equal(1)

			const summary = manager.completeSwap()
			expect(summary).to.equal("Checkpoint summary")
			expect(manager.getState().phase).to.equal("normal")
			expect(manager.getState().generation).to.equal(1)
		})
	})

	describe("multiple generations", () => {
		it("increments generation on each checkpoint", () => {
			for (let i = 0; i < 3; i++) {
				manager.beginCheckpoint(10)
				manager.finishCheckpoint(`Summary gen ${i + 1}`)
				manager.completeSwap()
			}
			expect(manager.getState().generation).to.equal(3)
		})
	})

	describe("reset", () => {
		it("clears all state", () => {
			manager.beginCheckpoint(10)
			manager.finishCheckpoint("Summary")
			manager.reset()
			const state = manager.getState()
			expect(state.phase).to.equal("normal")
			expect(state.checkpointSummary).to.be.null
			expect(state.generation).to.equal(0)
		})
	})

	describe("shouldCheckpoint", () => {
		it("returns false when not in normal phase", () => {
			manager.beginCheckpoint(10)
			// Create mock data for 120k tokens (above 60% of 200k)
			const mockMessages = createMockMessagesWithTokens(120_000)
			const mockApi = createMockApi(200_000)
			expect(manager.shouldCheckpoint(mockMessages, mockApi, 0)).to.be.false
		})

		it("returns false when below threshold", () => {
			// 50k tokens is below 60% of 200k (120k)
			const mockMessages = createMockMessagesWithTokens(50_000)
			const mockApi = createMockApi(200_000)
			expect(manager.shouldCheckpoint(mockMessages, mockApi, 0)).to.be.false
		})

		it("returns true when at threshold", () => {
			// 120k tokens is exactly 60% of 200k
			const mockMessages = createMockMessagesWithTokens(120_000)
			const mockApi = createMockApi(200_000)
			expect(manager.shouldCheckpoint(mockMessages, mockApi, 0)).to.be.true
		})
	})

	describe("shouldSwap", () => {
		it("returns false when not in concurrent phase", () => {
			const mockMessages = createMockMessagesWithTokens(170_000)
			const mockApi = createMockApi(200_000)
			expect(manager.shouldSwap(mockMessages, mockApi, 0)).to.be.false
		})

		it("returns false when no checkpoint summary", () => {
			manager.beginCheckpoint(10)
			// Force phase without summary
			;(manager as any).state.phase = "concurrent"
			const mockMessages = createMockMessagesWithTokens(170_000)
			const mockApi = createMockApi(200_000)
			expect(manager.shouldSwap(mockMessages, mockApi, 0)).to.be.false
		})

		it("returns true when in concurrent phase with summary and above threshold", () => {
			manager.beginCheckpoint(10)
			manager.finishCheckpoint("Summary")
			// 170k tokens is above 85% of 200k (170k)
			const mockMessages = createMockMessagesWithTokens(170_000)
			const mockApi = createMockApi(200_000)
			expect(manager.shouldSwap(mockMessages, mockApi, 0)).to.be.true
		})
	})
})
