import { RemovePromptRequest } from "@shared/proto/cline/prompts"
import * as assert from "assert"
import * as sinon from "sinon"

// Use require for proxyquire to work in this test environment
const proxyquire = require("proxyquire")

// Create stubs at module scope
const getWorkspacePathStub = sinon.stub()
const fsUnlinkStub = sinon.stub()
const fsRmdirStub = sinon.stub()

// Load module with proxyquire at module scope
const { removePrompt } = proxyquire("../removePrompt", {
	"@/utils/path": {
		getWorkspacePath: getWorkspacePathStub,
	},
	"node:fs/promises": {
		unlink: fsUnlinkStub,
		rmdir: fsRmdirStub,
		"@noCallThru": true,
	},
})

describe("removePrompt", () => {
	let mockController: any

	beforeEach(() => {
		mockController = {}
		// Reset stubs before each test
		getWorkspacePathStub.reset()
		fsUnlinkStub.reset()
		fsRmdirStub.reset()
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("File Operations", () => {
		it("should remove file from .clinerules/ for RULE type", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsUnlinkStub.resolves()

			const request = RemovePromptRequest.create({
				promptId: "test-prompt",
				type: 1, // RULE
				name: "Test Prompt",
			})

			const result = await removePrompt(mockController, request)

			assert.strictEqual(result.value, true)
			assert.ok(fsUnlinkStub.calledWith(sinon.match(/\.clinerules.*test-prompt\.md$/)))
		})

		it("should remove file from .clinerules/workflows/ for WORKFLOW type", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsUnlinkStub.resolves()

			const request = RemovePromptRequest.create({
				promptId: "test-workflow",
				type: 2, // WORKFLOW
				name: "Test Workflow",
			})

			const result = await removePrompt(mockController, request)

			assert.strictEqual(result.value, true)
			assert.ok(fsUnlinkStub.calledWith(sinon.match(/\.clinerules[/\\]workflows.*test-workflow\.md$/)))
		})

		it("should remove file from .clinerules/hooks/ for HOOK type", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsUnlinkStub.resolves()

			const request = RemovePromptRequest.create({
				promptId: "test-hook",
				type: 3, // HOOK
				name: "Test Hook",
			})

			const result = await removePrompt(mockController, request)

			assert.strictEqual(result.value, true)
			assert.ok(fsUnlinkStub.calledWith(sinon.match(/\.clinerules[/\\]hooks.*test-hook\.md$/)))
		})

		it("should remove SKILL.md from .clinerules/skills/{name}/ for SKILL type", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsUnlinkStub.resolves()
			fsRmdirStub.resolves()

			const request = RemovePromptRequest.create({
				promptId: "test-skill",
				type: 4, // SKILL
				name: "Test Skill",
			})

			const result = await removePrompt(mockController, request)

			assert.strictEqual(result.value, true)
			assert.ok(fsUnlinkStub.calledWith(sinon.match(/\.clinerules[/\\]skills[/\\]test-skill[/\\]SKILL\.md$/)))
		})

		it("should try to clean up empty skill directory after removing SKILL.md", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsUnlinkStub.resolves()
			fsRmdirStub.resolves()

			const request = RemovePromptRequest.create({
				promptId: "test-skill",
				type: 4, // SKILL
				name: "Test Skill",
			})

			await removePrompt(mockController, request)

			assert.ok(fsRmdirStub.calledWith(sinon.match(/\.clinerules[/\\]skills[/\\]test-skill$/)))
		})

		it("should succeed even if skill directory cleanup fails (non-empty)", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsUnlinkStub.resolves()
			fsRmdirStub.rejects(new Error("ENOTEMPTY"))

			const request = RemovePromptRequest.create({
				promptId: "test-skill",
				type: 4, // SKILL
				name: "Test Skill",
			})

			const result = await removePrompt(mockController, request)

			assert.strictEqual(result.value, true)
		})

		it("should return success when file is deleted", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsUnlinkStub.resolves()

			const request = RemovePromptRequest.create({
				promptId: "test",
				type: 1,
				name: "Test",
			})

			const result = await removePrompt(mockController, request)

			assert.strictEqual(result.value, true)
		})

		it("should generate correct kebab-case filename", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsUnlinkStub.resolves()

			const request = RemovePromptRequest.create({
				promptId: "test-prompt",
				type: 1,
				name: "Test Prompt With Spaces",
			})

			await removePrompt(mockController, request)

			assert.ok(fsUnlinkStub.calledWith(sinon.match(/test-prompt-with-spaces\.md$/)))
		})
	})

	describe("Error Handling", () => {
		it("should return false when workspace path is unavailable", async () => {
			getWorkspacePathStub.resolves(null)

			const request = RemovePromptRequest.create({
				promptId: "test",
				type: 1,
				name: "Test",
			})

			const result = await removePrompt(mockController, request)

			assert.strictEqual(result.value, false)
		})

		it("should return false when file doesn't exist (graceful failure)", async () => {
			getWorkspacePathStub.resolves("/workspace")
			const error: any = new Error("ENOENT: no such file or directory")
			error.code = "ENOENT"
			fsUnlinkStub.rejects(error)

			const request = RemovePromptRequest.create({
				promptId: "nonexistent",
				type: 1,
				name: "Nonexistent",
			})

			const result = await removePrompt(mockController, request)

			assert.strictEqual(result.value, false)
		})

		it("should return false when file deletion fails (permission denied)", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsUnlinkStub.rejects(new Error("EACCES: permission denied"))

			const request = RemovePromptRequest.create({
				promptId: "test",
				type: 1,
				name: "Test",
			})

			const result = await removePrompt(mockController, request)

			assert.strictEqual(result.value, false)
		})
	})
})
