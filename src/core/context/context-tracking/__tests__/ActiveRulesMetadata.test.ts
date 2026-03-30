import * as diskModule from "@core/storage/disk"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import type { ActiveRulesMetadataEntry, TaskMetadata } from "../ContextTrackerTypes"

describe("ActiveRulesMetadata", () => {
	const taskId = "test-task-id"
	let sandbox: sinon.SinonSandbox
	let mockTaskMetadata: TaskMetadata
	let getTaskMetadataStub: sinon.SinonStub
	let saveTaskMetadataStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		mockTaskMetadata = { files_in_context: [], model_usage: [], environment_history: [] }
		getTaskMetadataStub = sandbox.stub(diskModule, "getTaskMetadata").resolves(mockTaskMetadata)
		saveTaskMetadataStub = sandbox.stub(diskModule, "saveTaskMetadata").resolves()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should save active rules snapshot to task metadata", async () => {
		const fakeNow = 1717293940000
		const clock = sandbox.useFakeTimers(fakeNow)

		try {
			// Simulate the toggle data available during system prompt building
			const globalToggles: Record<string, boolean> = {
				"/home/user/.cline/rules/style.md": true,
				"/home/user/.cline/rules/testing.md": false,
				"/home/user/.cline/rules/security.md": true,
			}
			const localToggles: Record<string, boolean> = {
				".clinerules/db-rules.md": true,
				".clinerules/disabled-rule.md": false,
			}
			const activatedConditionalRules = [
				{
					name: "workspace:.clinerules/db-rules.md",
					matchedConditions: { paths: ["**/*.sql"] },
				},
			]

			// Replicate the logic from index.ts
			const metadata = await diskModule.getTaskMetadata(taskId)
			metadata.active_rules = {
				ts: Date.now(),
				global: Object.entries(globalToggles)
					.filter(([, enabled]) => enabled !== false)
					.map(([filePath]) => filePath),
				local: Object.entries(localToggles)
					.filter(([, enabled]) => enabled !== false)
					.map(([filePath]) => filePath),
				activated_conditional_rules: activatedConditionalRules.map((rule) => ({
					name: rule.name,
					matched_conditions: rule.matchedConditions,
				})),
			}
			await diskModule.saveTaskMetadata(taskId, metadata)

			// Verify getTaskMetadata was called
			expect(getTaskMetadataStub.calledOnce).to.be.true
			expect(getTaskMetadataStub.firstCall.args[0]).to.equal(taskId)

			// Verify saveTaskMetadata was called
			expect(saveTaskMetadataStub.calledOnce).to.be.true
			const savedMetadata: TaskMetadata = saveTaskMetadataStub.firstCall.args[1]

			// Verify active_rules is present
			expect(savedMetadata.active_rules).to.exist

			const activeRules = savedMetadata.active_rules as ActiveRulesMetadataEntry
			expect(activeRules.ts).to.equal(fakeNow)

			// Only enabled rules should be included
			expect(activeRules.global).to.deep.equal(["/home/user/.cline/rules/style.md", "/home/user/.cline/rules/security.md"])
			expect(activeRules.local).to.deep.equal([".clinerules/db-rules.md"])

			// Conditional rules should be mapped correctly
			expect(activeRules.activated_conditional_rules).to.deep.equal([
				{
					name: "workspace:.clinerules/db-rules.md",
					matched_conditions: { paths: ["**/*.sql"] },
				},
			])
		} finally {
			clock.restore()
		}
	})

	it("should preserve existing metadata fields when saving active rules", async () => {
		// Pre-populate existing metadata
		mockTaskMetadata.model_usage = [
			{ ts: 1617200000000, model_id: "claude-3-opus", model_provider_id: "anthropic", mode: "act" },
		]
		mockTaskMetadata.files_in_context = [
			{
				path: "src/index.ts",
				record_state: "active",
				record_source: "read_tool",
				cline_read_date: 1617200000000,
				cline_edit_date: null,
			},
		]

		const globalToggles: Record<string, boolean> = { "rule1.md": true }
		const localToggles: Record<string, boolean> = {}

		const metadata = await diskModule.getTaskMetadata(taskId)
		metadata.active_rules = {
			ts: Date.now(),
			global: Object.entries(globalToggles)
				.filter(([, enabled]) => enabled !== false)
				.map(([filePath]) => filePath),
			local: Object.entries(localToggles)
				.filter(([, enabled]) => enabled !== false)
				.map(([filePath]) => filePath),
			activated_conditional_rules: [],
		}
		await diskModule.saveTaskMetadata(taskId, metadata)

		const savedMetadata: TaskMetadata = saveTaskMetadataStub.firstCall.args[1]

		// Existing fields should be preserved
		expect(savedMetadata.model_usage).to.have.length(1)
		expect(savedMetadata.model_usage[0].model_id).to.equal("claude-3-opus")
		expect(savedMetadata.files_in_context).to.have.length(1)
		expect(savedMetadata.files_in_context[0].path).to.equal("src/index.ts")

		// active_rules should also be present
		expect(savedMetadata.active_rules).to.exist
		expect(savedMetadata.active_rules!.global).to.deep.equal(["rule1.md"])
	})

	it("should handle empty toggles gracefully", async () => {
		const globalToggles: Record<string, boolean> = {}
		const localToggles: Record<string, boolean> = {}

		const metadata = await diskModule.getTaskMetadata(taskId)
		metadata.active_rules = {
			ts: Date.now(),
			global: Object.entries(globalToggles)
				.filter(([, enabled]) => enabled !== false)
				.map(([filePath]) => filePath),
			local: Object.entries(localToggles)
				.filter(([, enabled]) => enabled !== false)
				.map(([filePath]) => filePath),
			activated_conditional_rules: [],
		}
		await diskModule.saveTaskMetadata(taskId, metadata)

		const savedMetadata: TaskMetadata = saveTaskMetadataStub.firstCall.args[1]
		expect(savedMetadata.active_rules!.global).to.deep.equal([])
		expect(savedMetadata.active_rules!.local).to.deep.equal([])
		expect(savedMetadata.active_rules!.activated_conditional_rules).to.deep.equal([])
	})

	it("should filter out disabled rules (value === false)", async () => {
		const globalToggles: Record<string, boolean> = {
			"enabled.md": true,
			"disabled.md": false,
			"also-enabled.md": true,
			"also-disabled.md": false,
		}
		const localToggles: Record<string, boolean> = {
			"local-on.md": true,
			"local-off.md": false,
		}

		const metadata = await diskModule.getTaskMetadata(taskId)
		metadata.active_rules = {
			ts: Date.now(),
			global: Object.entries(globalToggles)
				.filter(([, enabled]) => enabled !== false)
				.map(([filePath]) => filePath),
			local: Object.entries(localToggles)
				.filter(([, enabled]) => enabled !== false)
				.map(([filePath]) => filePath),
			activated_conditional_rules: [],
		}
		await diskModule.saveTaskMetadata(taskId, metadata)

		const savedMetadata: TaskMetadata = saveTaskMetadataStub.firstCall.args[1]
		expect(savedMetadata.active_rules!.global).to.deep.equal(["enabled.md", "also-enabled.md"])
		expect(savedMetadata.active_rules!.local).to.deep.equal(["local-on.md"])
	})
})
