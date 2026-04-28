import * as diskModule from "@core/storage/disk"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { buildActiveRulesMetadata } from "../buildActiveRulesMetadata"
import type { TaskMetadata } from "../ContextTrackerTypes"

describe("buildActiveRulesMetadata", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should include only enabled rules and map conditional rules correctly", () => {
		const fakeNow = 1717293940000
		const clock = sandbox.useFakeTimers(fakeNow)

		try {
			const result = buildActiveRulesMetadata({
				globalToggles: {
					"/home/user/.cline/rules/style.md": true,
					"/home/user/.cline/rules/testing.md": false,
					"/home/user/.cline/rules/security.md": true,
				},
				localToggles: {
					".clinerules/db-rules.md": true,
					".clinerules/disabled-rule.md": false,
				},
				cursorLocalToggles: { ".cursorrules": true },
				windsurfLocalToggles: { ".windsurfrules": false },
				agentsLocalToggles: { "AGENTS.md": true },
				activatedConditionalRules: [
					{
						name: "workspace:.clinerules/db-rules.md",
						matchedConditions: { paths: ["**/*.sql"] },
					},
				],
			})

			expect(result.ts).to.equal(fakeNow)
			expect(result.global).to.deep.equal(["/home/user/.cline/rules/style.md", "/home/user/.cline/rules/security.md"])
			expect(result.local).to.deep.equal([".clinerules/db-rules.md"])
			expect(result.cursor).to.deep.equal([".cursorrules"])
			expect(result.windsurf).to.deep.equal([])
			expect(result.agents).to.deep.equal(["AGENTS.md"])
			expect(result.activated_conditional_rules).to.deep.equal([
				{
					name: "workspace:.clinerules/db-rules.md",
					matched_conditions: { paths: ["**/*.sql"] },
				},
			])
		} finally {
			clock.restore()
		}
	})

	it("should handle empty toggles gracefully", () => {
		const result = buildActiveRulesMetadata({
			globalToggles: {},
			localToggles: {},
			cursorLocalToggles: {},
			windsurfLocalToggles: {},
			agentsLocalToggles: {},
			activatedConditionalRules: [],
		})

		expect(result.global).to.deep.equal([])
		expect(result.local).to.deep.equal([])
		expect(result.cursor).to.deep.equal([])
		expect(result.windsurf).to.deep.equal([])
		expect(result.agents).to.deep.equal([])
		expect(result.activated_conditional_rules).to.deep.equal([])
	})

	it("should filter out all disabled rules", () => {
		const result = buildActiveRulesMetadata({
			globalToggles: {
				"enabled.md": true,
				"disabled.md": false,
				"also-enabled.md": true,
				"also-disabled.md": false,
			},
			localToggles: {
				"local-on.md": true,
				"local-off.md": false,
			},
			cursorLocalToggles: {},
			windsurfLocalToggles: {},
			agentsLocalToggles: {},
			activatedConditionalRules: [],
		})

		expect(result.global).to.deep.equal(["enabled.md", "also-enabled.md"])
		expect(result.local).to.deep.equal(["local-on.md"])
	})
})

describe("ActiveRulesMetadata integration", () => {
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

	it("should save active rules and preserve existing metadata fields", async () => {
		mockTaskMetadata.model_usage = [
			{ ts: 1617200000000, model_id: "claude-3-opus", model_provider_id: "anthropic", mode: "act" },
		]

		const metadata = await diskModule.getTaskMetadata(taskId)
		metadata.active_rules = buildActiveRulesMetadata({
			globalToggles: { "rule1.md": true },
			localToggles: {},
			cursorLocalToggles: {},
			windsurfLocalToggles: {},
			agentsLocalToggles: {},
			activatedConditionalRules: [],
		})
		await diskModule.saveTaskMetadata(taskId, metadata)

		const savedMetadata: TaskMetadata = saveTaskMetadataStub.firstCall.args[1]
		expect(savedMetadata.model_usage).to.have.length(1)
		expect(savedMetadata.active_rules).to.exist
		expect(savedMetadata.active_rules!.global).to.deep.equal(["rule1.md"])
	})

	it("should not overwrite active_rules if already present (first-turn guard)", async () => {
		// Simulate metadata already having active_rules from first turn
		mockTaskMetadata.active_rules = {
			ts: 1617200000000,
			global: ["original-rule.md"],
			local: [],
			cursor: [],
			windsurf: [],
			agents: [],
			activated_conditional_rules: [],
		}

		const metadata = await diskModule.getTaskMetadata(taskId)

		// Replicate the guard from index.ts
		if (!metadata.active_rules) {
			metadata.active_rules = buildActiveRulesMetadata({
				globalToggles: { "new-rule.md": true },
				localToggles: {},
				cursorLocalToggles: {},
				windsurfLocalToggles: {},
				agentsLocalToggles: {},
				activatedConditionalRules: [],
			})
			await diskModule.saveTaskMetadata(taskId, metadata)
		}

		// saveTaskMetadata should NOT have been called
		expect(saveTaskMetadataStub.called).to.be.false
		// Original active_rules should be preserved
		expect(metadata.active_rules.global).to.deep.equal(["original-rule.md"])
	})
})
