import { RemovePromptRequest } from "@shared/proto/cline/prompts"
import * as assert from "assert"
import * as sinon from "sinon"

// Use require for proxyquire to work in this test environment
const proxyquire = require("proxyquire")

// Create stubs at module scope
const getWorkspacePathStub = sinon.stub()
const fsUnlinkStub = sinon.stub()

// Load module with proxyquire at module scope
const { removePrompt } = proxyquire("../removePrompt", {
	"@/utils/path": {
		getWorkspacePath: getWorkspacePathStub,
	},
	"node:fs/promises": {
		unlink: fsUnlinkStub,
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

		it("should remove file from workflows/ for WORKFLOW type", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsUnlinkStub.resolves()

			const request = RemovePromptRequest.create({
				promptId: "test-workflow",
				type: 2, // WORKFLOW
				name: "Test Workflow",
			})

			const result = await removePrompt(mockController, request)

			assert.strictEqual(result.value, true)
			assert.ok(fsUnlinkStub.calledWith(sinon.match(/workflows.*test-workflow\.md$/)))
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
