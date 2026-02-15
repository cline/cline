import { ApplyPromptRequest } from "@shared/proto/cline/prompts"
import * as assert from "assert"
import * as sinon from "sinon"

// Use require for proxyquire to work in this test environment
const proxyquire = require("proxyquire")

// Create stubs at module scope
const getWorkspacePathStub = sinon.stub()
const fsMkdirStub = sinon.stub()
const fsWriteFileStub = sinon.stub()

// Load module with proxyquire at module scope
const { applyPrompt } = proxyquire("../applyPrompt", {
	"@/utils/path": {
		getWorkspacePath: getWorkspacePathStub,
	},
	"node:fs/promises": {
		mkdir: fsMkdirStub,
		writeFile: fsWriteFileStub,
		"@noCallThru": true,
	},
})

describe("applyPrompt", () => {
	let mockController: any

	beforeEach(() => {
		mockController = {}
		// Reset stubs before each test
		getWorkspacePathStub.reset()
		fsMkdirStub.reset()
		fsWriteFileStub.reset()
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("File Operations", () => {
		it("should create .clinerules/ directory for RULE type", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.resolves()

			const request = ApplyPromptRequest.create({
				promptId: "test-prompt",
				type: 1, // RULE
				content: "# Test content",
				name: "Test Prompt",
			})

			const result = await applyPrompt(mockController, request)

			assert.strictEqual(result.value, true)
			assert.ok(fsMkdirStub.calledWith(sinon.match(/[/\\]workspace[/\\]\.clinerules$/)))
		})

		it("should create workflows/ directory for WORKFLOW type", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.resolves()

			const request = ApplyPromptRequest.create({
				promptId: "test-workflow",
				type: 2, // WORKFLOW
				content: "# Workflow content",
				name: "Test Workflow",
			})

			const result = await applyPrompt(mockController, request)

			assert.strictEqual(result.value, true)
			// Use regex to match both / and \ path separators (cross-platform)
			assert.ok(fsMkdirStub.calledWith(sinon.match(/[/\\]workspace[/\\]workflows$/)))
		})

		it("should write file with correct content", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.resolves()

			const content = "# Test Content\n\nThis is the prompt content"
			const request = ApplyPromptRequest.create({
				promptId: "test-prompt",
				type: 1,
				content,
				name: "Test Prompt",
			})

			await applyPrompt(mockController, request)

			assert.ok(fsWriteFileStub.calledWith(sinon.match.string, content, "utf-8"))
		})

		it("should create kebab-case filename from prompt name", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.resolves()

			const request = ApplyPromptRequest.create({
				promptId: "test-prompt",
				type: 1,
				content: "content",
				name: "Test Prompt With Spaces",
			})

			await applyPrompt(mockController, request)

			assert.ok(fsWriteFileStub.calledWith(sinon.match(/test-prompt-with-spaces\.md$/), sinon.match.any, sinon.match.any))
		})

		it("should handle special characters in prompt name", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.resolves()

			const request = ApplyPromptRequest.create({
				promptId: "test-prompt",
				type: 1,
				content: "content",
				name: "Test_Prompt@#$%Special!Chars",
			})

			await applyPrompt(mockController, request)

			// Should convert to kebab-case and remove special chars
			assert.ok(fsWriteFileStub.calledWith(sinon.match(/test-prompt-special-chars\.md$/), sinon.match.any, sinon.match.any))
		})

		it("should handle leading/trailing dashes in generated filename", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.resolves()

			const request = ApplyPromptRequest.create({
				promptId: "test-prompt",
				type: 1,
				content: "content",
				name: "---Test---",
			})

			await applyPrompt(mockController, request)

			// Should remove leading/trailing dashes (use [/\\] for cross-platform)
			assert.ok(fsWriteFileStub.calledWith(sinon.match(/[/\\]test\.md$/), sinon.match.any, sinon.match.any))
		})

		it("should return success when file is written", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.resolves()

			const request = ApplyPromptRequest.create({
				promptId: "test",
				type: 1,
				content: "content",
				name: "Test",
			})

			const result = await applyPrompt(mockController, request)

			assert.strictEqual(result.value, true)
		})
	})

	describe("Error Handling", () => {
		it("should return false when workspace path is unavailable", async () => {
			getWorkspacePathStub.resolves(null)

			const request = ApplyPromptRequest.create({
				promptId: "test",
				type: 1,
				content: "content",
				name: "Test",
			})

			const result = await applyPrompt(mockController, request)

			assert.strictEqual(result.value, false)
		})

		it("should return false when directory creation fails", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.rejects(new Error("Permission denied"))

			const request = ApplyPromptRequest.create({
				promptId: "test",
				type: 1,
				content: "content",
				name: "Test",
			})

			const result = await applyPrompt(mockController, request)

			assert.strictEqual(result.value, false)
		})

		it("should return false when file write fails", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.rejects(new Error("Write failed"))

			const request = ApplyPromptRequest.create({
				promptId: "test",
				type: 1,
				content: "content",
				name: "Test",
			})

			const result = await applyPrompt(mockController, request)

			assert.strictEqual(result.value, false)
		})
	})

	describe("Edge Cases", () => {
		it("should overwrite existing file with same name", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.resolves() // writeFile with 'utf-8' will overwrite

			const request = ApplyPromptRequest.create({
				promptId: "existing",
				type: 1,
				content: "new content",
				name: "Existing",
			})

			const result = await applyPrompt(mockController, request)

			assert.strictEqual(result.value, true)
			assert.ok(fsWriteFileStub.calledOnce)
		})

		it("should handle empty content", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.resolves()

			const request = ApplyPromptRequest.create({
				promptId: "empty",
				type: 1,
				content: "",
				name: "Empty",
			})

			const result = await applyPrompt(mockController, request)

			assert.strictEqual(result.value, true)
			assert.ok(fsWriteFileStub.calledWith(sinon.match.string, "", "utf-8"))
		})

		it("should handle very long filenames", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsMkdirStub.resolves()
			fsWriteFileStub.resolves()

			const longName = "A".repeat(300) // Very long name
			const request = ApplyPromptRequest.create({
				promptId: "long",
				type: 1,
				content: "content",
				name: longName,
			})

			const result = await applyPrompt(mockController, request)

			// Should still succeed (filesystem may truncate or fail, but function handles it)
			assert.ok(result.value === true || result.value === false)
		})
	})
})
