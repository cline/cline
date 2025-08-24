import * as diskModule from "@core/storage/disk"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import type { TaskMetadata } from "./ContextTrackerTypes"
import { ModelContextTracker } from "./ModelContextTracker"

describe("ModelContextTracker", () => {
	let sandbox: sinon.SinonSandbox
	let mockContext: vscode.ExtensionContext
	let tracker: ModelContextTracker
	let taskId: string
	let mockTaskMetadata: TaskMetadata
	let getTaskMetadataStub: sinon.SinonStub
	let saveTaskMetadataStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Mock controller and context
		mockContext = {
			globalStorageUri: { fsPath: "/mock/storage" },
		} as unknown as vscode.ExtensionContext

		// Mock disk module functions
		mockTaskMetadata = { files_in_context: [], model_usage: [] }
		getTaskMetadataStub = sandbox.stub(diskModule, "getTaskMetadata").resolves(mockTaskMetadata)
		saveTaskMetadataStub = sandbox.stub(diskModule, "saveTaskMetadata").resolves()

		// Create tracker instance
		taskId = "test-task-id"
		tracker = new ModelContextTracker(mockContext, taskId)
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should record model usage with correct data", async () => {
		// Test data
		const apiProviderId = "anthropic"
		const modelId = "claude-3-opus"
		const mode = "act"

		// Use a fake timer to have a predictable timestamp
		const fakeNow = 1617293940000 // Some fixed timestamp
		const clock = sandbox.useFakeTimers(fakeNow)

		try {
			// Call the method being tested
			await tracker.recordModelUsage(apiProviderId, modelId, mode)

			// Verify getTaskMetadata was called with correct parameters
			expect(getTaskMetadataStub.calledOnce).to.be.true
			expect(getTaskMetadataStub.firstCall.args[1]).to.equal(taskId)

			// Verify saveTaskMetadata was called with the correct data
			expect(saveTaskMetadataStub.calledOnce).to.be.true

			// Extract the saved metadata from the call arguments
			const savedMetadata = saveTaskMetadataStub.firstCall.args[2]

			// Verify model_usage array has one entry
			expect(savedMetadata.model_usage.length).to.equal(1)

			// Verify the entry has the correct properties
			const modelUsageEntry = savedMetadata.model_usage[0]
			expect(modelUsageEntry.ts).to.equal(fakeNow)
			expect(modelUsageEntry.model_id).to.equal(modelId)
			expect(modelUsageEntry.model_provider_id).to.equal(apiProviderId)
			expect(modelUsageEntry.mode).to.equal(mode)
		} finally {
			// Restore the clock
			clock.restore()
		}
	})

	it("should append model usage to existing entries", async () => {
		// Add an existing model usage entry
		const existingTimestamp = 1617200000000
		mockTaskMetadata.model_usage = [
			{
				ts: existingTimestamp,
				model_id: "existing-model",
				model_provider_id: "existing-provider",
				mode: "plan",
			},
		]

		// Test data for new entry
		const apiProviderId = "anthropic"
		const modelId = "claude-3-sonnet"
		const mode = "act"

		// Use a fake timer
		const newTimestamp = 1617300000000
		const clock = sandbox.useFakeTimers(newTimestamp)

		try {
			// Call the method being tested
			await tracker.recordModelUsage(apiProviderId, modelId, mode)

			// Verify saveTaskMetadata was called
			expect(saveTaskMetadataStub.calledOnce).to.be.true

			// Extract the saved metadata
			const savedMetadata = saveTaskMetadataStub.firstCall.args[2]

			// Verify model_usage array now has two entries
			expect(savedMetadata.model_usage.length).to.equal(2)

			// Verify the existing entry is preserved
			expect(savedMetadata.model_usage[0]).to.deep.equal({
				ts: existingTimestamp,
				model_id: "existing-model",
				model_provider_id: "existing-provider",
				mode: "plan",
			})

			// Verify the new entry has correct data
			expect(savedMetadata.model_usage[1]).to.deep.equal({
				ts: newTimestamp,
				model_id: modelId,
				model_provider_id: apiProviderId,
				mode: mode,
			})
		} finally {
			clock.restore()
		}
	})

	it("should handle multiple model usages in sequence", async () => {
		// Test data for sequential calls
		const usages = [
			{ provider: "anthropic", model: "claude-3-opus", mode: "plan" },
			{ provider: "openai", model: "gpt-4", mode: "act" },
			{ provider: "anthropic", model: "claude-3-haiku", mode: "plan" },
		]

		// Use a fake timer that advances with each call
		const startTime = 1617300000000
		const clock = sandbox.useFakeTimers(startTime)

		try {
			// Record multiple model usages
			for (let i = 0; i < usages.length; i++) {
				const { provider, model, mode } = usages[i]

				// Advance time by 1 second for each call
				clock.tick(1000)
				const expectedTime = startTime + (i + 1) * 1000

				// Reset history between calls to check individual call behavior
				getTaskMetadataStub.resetHistory()
				saveTaskMetadataStub.resetHistory()

				// Reset mock metadata for each iteration to avoid accumulation
				mockTaskMetadata.model_usage = []

				// Call the method
				await tracker.recordModelUsage(provider, model, mode)

				// Verify interaction with disk module
				expect(getTaskMetadataStub.calledOnce).to.be.true
				expect(saveTaskMetadataStub.calledOnce).to.be.true

				// Get the saved metadata
				const savedMetadata = saveTaskMetadataStub.firstCall.args[2]

				// Since we reset the array for each call, we should always have 1 entry
				expect(savedMetadata.model_usage.length).to.equal(1)

				// Check the entry
				const entry = savedMetadata.model_usage[0]
				expect(entry.ts).to.equal(expectedTime)
				expect(entry.model_id).to.equal(model)
				expect(entry.model_provider_id).to.equal(provider)
				expect(entry.mode).to.equal(mode)
			}
		} finally {
			clock.restore()
		}
	})
})
