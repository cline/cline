import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as skillsUtils from "@core/context/instructions/user-instructions/skills"
import * as sinon from "sinon"
import { Controller } from "../core/controller"
import { getAvailableSlashCommands } from "../core/controller/slash/getAvailableSlashCommands"
import { EmptyRequest } from "../shared/proto/cline/common"
import { BASE_SLASH_COMMANDS } from "../shared/slashCommands"

/**
 * Unit tests for getAvailableSlashCommands RPC endpoint
 * Tests the slash command discovery and filtering functionality
 */
describe("getAvailableSlashCommands", () => {
	let mockController: Partial<Controller>
	let mockStateManager: {
		getWorkspaceStateKey: sinon.SinonStub
		getGlobalSettingsKey: sinon.SinonStub
		getGlobalStateKey: sinon.SinonStub
		getRemoteConfigSettings: sinon.SinonStub
	}

	beforeEach(() => {
		mockStateManager = {
			getWorkspaceStateKey: sinon.stub(),
			getGlobalSettingsKey: sinon.stub(),
			getGlobalStateKey: sinon.stub(),
			getRemoteConfigSettings: sinon.stub(),
		}

		// Default stubs return empty/null values
		mockStateManager.getWorkspaceStateKey.returns(null)
		mockStateManager.getGlobalSettingsKey.returns(null)
		mockStateManager.getGlobalStateKey.returns(null)
		mockStateManager.getRemoteConfigSettings.returns(null)

		mockController = {
			stateManager: mockStateManager as any,
		}

		sinon.stub(skillsUtils, "discoverSkills").resolves([])
		sinon.stub(skillsUtils, "getAvailableSkills").returns([])
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("Base Slash Commands", () => {
		it("should return all base slash commands", async () => {
			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			// Should have at least all base commands
			response.commands.length.should.be.greaterThanOrEqual(BASE_SLASH_COMMANDS.length)

			// Verify each base command is present
			for (const baseCmd of BASE_SLASH_COMMANDS) {
				const found = response.commands.find((cmd) => cmd.name === baseCmd.name)
				found!.should.not.be.undefined()
				found!.description.should.equal(baseCmd.description)
				found!.section.should.equal("default")
				found!.cliCompatible.should.equal(baseCmd.cliCompatible ?? false)
			}
		})

		it("should not include the deprecated subagent slash command", async () => {
			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())
			const deprecatedCommand = response.commands.find((cmd) => cmd.name === "subagent")
			;(deprecatedCommand === undefined).should.be.true()
		})

		it("should mark base commands with section 'default'", async () => {
			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const baseCommandNames = BASE_SLASH_COMMANDS.map((cmd) => cmd.name)
			for (const cmd of response.commands) {
				if (baseCommandNames.includes(cmd.name)) {
					cmd.section.should.equal("default")
				}
			}
		})
	})

	describe("Local Workflow Toggles", () => {
		it("should include enabled local workflows", async () => {
			mockStateManager.getWorkspaceStateKey.withArgs("workflowToggles").returns({
				"/path/to/my-workflow.md": true,
				"/path/to/another-workflow.md": true,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const myWorkflow = response.commands.find((cmd) => cmd.name === "my-workflow")
			myWorkflow!.should.not.be.undefined()
			myWorkflow!.section.should.equal("custom")
			myWorkflow!.cliCompatible.should.equal(true)

			const anotherWorkflow = response.commands.find((cmd) => cmd.name === "another-workflow")
			anotherWorkflow!.should.not.be.undefined()
		})

		it("should exclude disabled local workflows", async () => {
			mockStateManager.getWorkspaceStateKey.withArgs("workflowToggles").returns({
				"/path/to/enabled-workflow.md": true,
				"/path/to/disabled-workflow.md": false,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const enabled = response.commands.find((cmd) => cmd.name === "enabled-workflow")
			enabled!.should.not.be.undefined()

			const disabled = response.commands.find((cmd) => cmd.name === "disabled-workflow")
			;(disabled === undefined).should.be.true()
		})

		it("should extract filename from full path", async () => {
			mockStateManager.getWorkspaceStateKey.withArgs("workflowToggles").returns({
				"/Users/test/project/.clinerules/workflows/deep-analysis.md": true,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const workflow = response.commands.find((cmd) => cmd.name === "deep-analysis")
			workflow!.should.not.be.undefined()
		})

		it("should handle Windows-style paths", async () => {
			mockStateManager.getWorkspaceStateKey.withArgs("workflowToggles").returns({
				"C:\\Users\\test\\project\\.clinerules\\workflows\\windows-workflow.md": true,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const workflow = response.commands.find((cmd) => cmd.name === "windows-workflow")
			workflow!.should.not.be.undefined()
		})
	})

	describe("Global Workflow Toggles", () => {
		it("should include enabled global workflows", async () => {
			mockStateManager.getGlobalSettingsKey.withArgs("globalWorkflowToggles").returns({
				"/global/path/global-workflow.md": true,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const workflow = response.commands.find((cmd) => cmd.name === "global-workflow")
			workflow!.should.not.be.undefined()
			workflow!.section.should.equal("custom")
		})

		it("should exclude disabled global workflows", async () => {
			mockStateManager.getGlobalSettingsKey.withArgs("globalWorkflowToggles").returns({
				"/global/path/disabled-global.md": false,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const workflow = response.commands.find((cmd) => cmd.name === "disabled-global")
			;(workflow === undefined).should.be.true()
		})
	})

	describe("Workflow Deduplication", () => {
		it("should prefer local workflows over global workflows with same name", async () => {
			// Same filename in both local and global
			mockStateManager.getWorkspaceStateKey.withArgs("workflowToggles").returns({
				"/local/path/shared-workflow.md": true,
			})
			mockStateManager.getGlobalSettingsKey.withArgs("globalWorkflowToggles").returns({
				"/global/path/shared-workflow.md": true,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			// Should only appear once
			const matches = response.commands.filter((cmd) => cmd.name === "shared-workflow")
			matches.length.should.equal(1)
		})

		it("should include global workflow if local with same name is disabled", async () => {
			mockStateManager.getWorkspaceStateKey.withArgs("workflowToggles").returns({
				"/local/path/shared-workflow.md": false, // disabled locally
			})
			mockStateManager.getGlobalSettingsKey.withArgs("globalWorkflowToggles").returns({
				"/global/path/shared-workflow.md": true, // enabled globally
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			// Global should appear since local is disabled
			const workflow = response.commands.find((cmd) => cmd.name === "shared-workflow")
			workflow!.should.not.be.undefined()
		})
	})

	describe("Remote Workflows", () => {
		it("should include alwaysEnabled remote workflows", async () => {
			mockStateManager.getRemoteConfigSettings.returns({
				remoteGlobalWorkflows: [{ name: "always-on-workflow", alwaysEnabled: true }],
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const workflow = response.commands.find((cmd) => cmd.name === "always-on-workflow")
			workflow!.should.not.be.undefined()
			workflow!.section.should.equal("custom")
		})

		it("should include remote workflows enabled by toggle", async () => {
			mockStateManager.getRemoteConfigSettings.returns({
				remoteGlobalWorkflows: [{ name: "toggle-workflow", alwaysEnabled: false }],
			})
			mockStateManager.getGlobalStateKey.withArgs("remoteWorkflowToggles").returns({
				"toggle-workflow": true, // not explicitly disabled
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const workflow = response.commands.find((cmd) => cmd.name === "toggle-workflow")
			workflow!.should.not.be.undefined()
		})

		it("should exclude remote workflows explicitly disabled by toggle", async () => {
			mockStateManager.getRemoteConfigSettings.returns({
				remoteGlobalWorkflows: [{ name: "disabled-remote", alwaysEnabled: false }],
			})
			mockStateManager.getGlobalStateKey.withArgs("remoteWorkflowToggles").returns({
				"disabled-remote": false,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const workflow = response.commands.find((cmd) => cmd.name === "disabled-remote")
			;(workflow === undefined).should.be.true()
		})

		it("should include remote workflows by default if not explicitly disabled", async () => {
			mockStateManager.getRemoteConfigSettings.returns({
				remoteGlobalWorkflows: [{ name: "default-enabled", alwaysEnabled: false }],
			})
			// No toggle entry for this workflow
			mockStateManager.getGlobalStateKey.withArgs("remoteWorkflowToggles").returns({})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const workflow = response.commands.find((cmd) => cmd.name === "default-enabled")
			workflow!.should.not.be.undefined()
		})
	})

	describe("Edge Cases", () => {
		it("should handle null/undefined state values gracefully", async () => {
			mockStateManager.getWorkspaceStateKey.returns(null)
			mockStateManager.getGlobalSettingsKey.returns(undefined)
			mockStateManager.getGlobalStateKey.returns(null)
			mockStateManager.getRemoteConfigSettings.returns(null)

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			// Should still return base commands
			response.commands.length.should.be.greaterThanOrEqual(BASE_SLASH_COMMANDS.length)
		})

		it("should handle empty workflow toggle objects", async () => {
			mockStateManager.getWorkspaceStateKey.withArgs("workflowToggles").returns({})
			mockStateManager.getGlobalSettingsKey.withArgs("globalWorkflowToggles").returns({})
			mockStateManager.getGlobalStateKey.withArgs("remoteWorkflowToggles").returns({})
			mockStateManager.getRemoteConfigSettings.returns({
				remoteGlobalWorkflows: [],
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			// Should only have base commands
			response.commands.length.should.equal(BASE_SLASH_COMMANDS.length)
		})

		it("should handle remote config with no remoteGlobalWorkflows property", async () => {
			mockStateManager.getRemoteConfigSettings.returns({})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			// Should not throw, just return base commands
			response.commands.length.should.be.greaterThanOrEqual(BASE_SLASH_COMMANDS.length)
		})
	})

	describe("Skills", () => {
		beforeEach(() => {
			;(skillsUtils.discoverSkills as sinon.SinonStub).resolves([
				{
					name: "summarize-pr",
					description: "Summarize a pull request",
					path: "/Users/test/.cline/skills/summarize-pr/SKILL.md",
					source: "global",
				},
				{
					name: "project-planner",
					description: "Plan a project",
					path: "/workspace/.clinerules/skills/project-planner/SKILL.md",
					source: "project",
				},
			])
			;(skillsUtils.getAvailableSkills as sinon.SinonStub).callsFake((skills) => skills)
		})

		it("should include enabled skills as slash commands", async () => {
			mockStateManager.getGlobalSettingsKey.withArgs("globalSkillsToggles").returns({
				"/Users/test/.cline/skills/summarize-pr/SKILL.md": true,
			})
			mockStateManager.getWorkspaceStateKey.withArgs("localSkillsToggles").returns({
				"/workspace/.clinerules/skills/project-planner/SKILL.md": true,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())

			const globalSkill = response.commands.find((cmd) => cmd.name === "summarize-pr")
			globalSkill!.should.not.be.undefined()
			globalSkill!.section.should.equal("skill")

			const localSkill = response.commands.find((cmd) => cmd.name === "project-planner")
			localSkill!.should.not.be.undefined()
			localSkill!.section.should.equal("skill")
		})

		it("should prefer skill when skill and workflow names collide", async () => {
			mockStateManager.getWorkspaceStateKey.withArgs("workflowToggles").returns({
				"/path/to/summarize-pr.md": true,
			})
			mockStateManager.getGlobalSettingsKey.withArgs("globalSkillsToggles").returns({
				"/Users/test/.cline/skills/summarize-pr/SKILL.md": true,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())
			const skillMatches = response.commands.filter((cmd) => cmd.name === "summarize-pr" && cmd.section === "skill")
			const workflowMatches = response.commands.filter((cmd) => cmd.name === "summarize-pr" && cmd.section === "custom")

			skillMatches.length.should.equal(1)
			workflowMatches.length.should.equal(0)
		})

		it("should exclude disabled skills", async () => {
			mockStateManager.getGlobalSettingsKey.withArgs("globalSkillsToggles").returns({
				"/Users/test/.cline/skills/summarize-pr/SKILL.md": false,
			})
			mockStateManager.getWorkspaceStateKey.withArgs("localSkillsToggles").returns({
				"/workspace/.clinerules/skills/project-planner/SKILL.md": false,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())
			const skillCommands = response.commands.filter((cmd) => cmd.section === "skill")
			skillCommands.length.should.equal(0)
		})

		it("should keep skill description unchanged when it overrides a workflow", async () => {
			mockStateManager.getWorkspaceStateKey.withArgs("workflowToggles").returns({
				"/path/to/summarize-pr.md": true,
			})
			mockStateManager.getGlobalSettingsKey.withArgs("globalSkillsToggles").returns({
				"/Users/test/.cline/skills/summarize-pr/SKILL.md": true,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())
			const skill = response.commands.find((cmd) => cmd.name === "summarize-pr" && cmd.section === "skill")

			skill?.description.should.equal("Summarize a pull request")
		})

		it("should keep skill description unchanged when it overrides a remote workflow", async () => {
			mockStateManager.getRemoteConfigSettings.returns({
				remoteGlobalWorkflows: [{ name: "summarize-pr", alwaysEnabled: true }],
			})
			mockStateManager.getGlobalSettingsKey.withArgs("globalSkillsToggles").returns({
				"/Users/test/.cline/skills/summarize-pr/SKILL.md": true,
			})

			const response = await getAvailableSlashCommands(mockController as Controller, EmptyRequest.create())
			const skill = response.commands.find((cmd) => cmd.name === "summarize-pr" && cmd.section === "skill")

			skill?.description.should.equal("Summarize a pull request")
		})
	})
})
