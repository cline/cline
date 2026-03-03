import { EmptyRequest } from "@shared/proto/cline/common"
import * as assert from "assert"
import * as sinon from "sinon"

// Use require for proxyquire to work in this test environment
const proxyquire = require("proxyquire")

// Create stubs at module scope
const getWorkspacePathStub = sinon.stub()
const fsReaddirStub = sinon.stub()

// Load module with proxyquire at module scope
const { getAppliedPrompts } = proxyquire("../getAppliedPrompts", {
	"@/utils/path": {
		getWorkspacePath: getWorkspacePathStub,
	},
	"node:fs/promises": {
		readdir: fsReaddirStub,
		"@noCallThru": true,
	},
})

describe("getAppliedPrompts", () => {
	let mockController: any

	beforeEach(() => {
		mockController = {}
		// Reset stubs before each test
		getWorkspacePathStub.reset()
		fsReaddirStub.reset()
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("Directory Scanning", () => {
		it("should return empty array when no workspace", async () => {
			getWorkspacePathStub.resolves(null)

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, [])
		})

		it("should scan .clinerules/ directory correctly", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsReaddirStub.withArgs(sinon.match(/\.clinerules$/)).resolves(["prompt1.md", "prompt2.md"] as any)
			fsReaddirStub.withArgs(sinon.match(/workflows$/)).resolves([] as any)

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["prompt1", "prompt2"])
		})

		it("should scan workflows/ directory correctly", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsReaddirStub.withArgs(sinon.match(/\.clinerules$/)).resolves([] as any)
			fsReaddirStub.withArgs(sinon.match(/workflows$/)).resolves(["workflow1.md", "workflow2.md"] as any)

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["workflow1", "workflow2"])
		})

		it("should extract prompt IDs from .md filenames", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsReaddirStub.withArgs(sinon.match(/\.clinerules$/)).resolves(["test-prompt.md", "another-prompt.md"] as any)
			fsReaddirStub.withArgs(sinon.match(/workflows$/)).resolves([] as any)

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["test-prompt", "another-prompt"])
		})

		it("should ignore non-.md files", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsReaddirStub
				.withArgs(sinon.match(/\.clinerules$/))
				.resolves(["prompt.md", "readme.txt", ".DS_Store", "config.json"] as any)
			fsReaddirStub.withArgs(sinon.match(/workflows$/)).resolves([] as any)

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["prompt"])
		})

		it("should return combined list from both directories", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsReaddirStub.withArgs(sinon.match(/\.clinerules$/)).resolves(["rule1.md", "rule2.md"] as any)
			fsReaddirStub.withArgs(sinon.match(/workflows$/)).resolves(["workflow1.md"] as any)

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["rule1", "rule2", "workflow1"])
		})

		it("should handle empty directories", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsReaddirStub.withArgs(sinon.match(/\.clinerules$/)).resolves([] as any)
			fsReaddirStub.withArgs(sinon.match(/workflows$/)).resolves([] as any)

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, [])
		})
	})

	describe("Error Handling", () => {
		it("should gracefully handle missing .clinerules/ directory", async () => {
			getWorkspacePathStub.resolves("/workspace")
			const error: any = new Error("ENOENT: no such file or directory")
			error.code = "ENOENT"
			fsReaddirStub.withArgs(sinon.match(/\.clinerules$/)).rejects(error)
			fsReaddirStub.withArgs(sinon.match(/workflows$/)).resolves(["workflow.md"] as any)

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			// Should still return workflows even if .clinerules is missing
			assert.deepStrictEqual(result.values, ["workflow"])
		})

		it("should gracefully handle missing workflows/ directory", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsReaddirStub.withArgs(sinon.match(/\.clinerules$/)).resolves(["rule.md"] as any)
			const error: any = new Error("ENOENT: no such file or directory")
			error.code = "ENOENT"
			fsReaddirStub.withArgs(sinon.match(/workflows$/)).rejects(error)

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			// Should still return .clinerules even if workflows is missing
			assert.deepStrictEqual(result.values, ["rule"])
		})

		it("should handle permission denied errors", async () => {
			getWorkspacePathStub.resolves("/workspace")
			const error: any = new Error("EACCES: permission denied")
			error.code = "EACCES"
			fsReaddirStub.rejects(error)

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			// Should return empty array on permission errors
			assert.deepStrictEqual(result.values, [])
		})

		it("should return empty array on unexpected errors", async () => {
			getWorkspacePathStub.resolves("/workspace")
			fsReaddirStub.rejects(new Error("Unexpected error"))

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, [])
		})

		it("should handle error in getWorkspacePath", async () => {
			getWorkspacePathStub.rejects(new Error("Workspace error"))

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, [])
		})
	})
})
