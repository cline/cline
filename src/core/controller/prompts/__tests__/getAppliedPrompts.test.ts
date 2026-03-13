import { EmptyRequest } from "@shared/proto/cline/common"
import * as assert from "assert"
import * as sinon from "sinon"

// Use require for proxyquire to work in this test environment
const proxyquire = require("proxyquire")

// Create stubs at module scope
const getWorkspacePathStub = sinon.stub()
const fsReaddirStub = sinon.stub()
const fsStatStub = sinon.stub()

// Load module with proxyquire at module scope
const { getAppliedPrompts } = proxyquire("../getAppliedPrompts", {
	"@/utils/path": {
		getWorkspacePath: getWorkspacePathStub,
	},
	"node:fs/promises": {
		readdir: fsReaddirStub,
		stat: fsStatStub,
		"@noCallThru": true,
	},
})

/**
 * Helper: stubs readdir for the four standard directories.
 * Pass arrays of filenames for each; defaults to empty.
 */
function stubDirectories(opts: { rules?: string[]; workflows?: string[]; hooks?: string[]; skills?: string[] }) {
	const enoent: any = new Error("ENOENT")
	enoent.code = "ENOENT"

	// .clinerules/ (top-level rules)
	if (opts.rules) {
		fsReaddirStub.withArgs(sinon.match(/\.clinerules$/)).resolves(opts.rules as any)
	} else {
		fsReaddirStub.withArgs(sinon.match(/\.clinerules$/)).rejects(enoent)
	}

	// .clinerules/workflows/
	if (opts.workflows) {
		fsReaddirStub.withArgs(sinon.match(/workflows$/)).resolves(opts.workflows as any)
	} else {
		fsReaddirStub.withArgs(sinon.match(/workflows$/)).rejects(enoent)
	}

	// .clinerules/hooks/
	if (opts.hooks) {
		fsReaddirStub.withArgs(sinon.match(/hooks$/)).resolves(opts.hooks as any)
	} else {
		fsReaddirStub.withArgs(sinon.match(/hooks$/)).rejects(enoent)
	}

	// .clinerules/skills/
	if (opts.skills) {
		fsReaddirStub.withArgs(sinon.match(/skills$/)).resolves(opts.skills as any)
	} else {
		fsReaddirStub.withArgs(sinon.match(/skills$/)).rejects(enoent)
	}
}

describe("getAppliedPrompts", () => {
	let mockController: any

	beforeEach(() => {
		mockController = {}
		// Reset stubs before each test
		getWorkspacePathStub.reset()
		fsReaddirStub.reset()
		fsStatStub.reset()
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
			stubDirectories({
				rules: ["prompt1.md", "prompt2.md"],
				workflows: [],
				hooks: [],
				skills: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["rule:prompt1", "rule:prompt2"])
		})

		it("should scan .clinerules/workflows/ directory correctly", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: [],
				workflows: ["workflow1.md", "workflow2.md"],
				hooks: [],
				skills: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["workflow:workflow1", "workflow:workflow2"])
		})

		it("should scan .clinerules/hooks/ directory correctly", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: [],
				workflows: [],
				hooks: ["hook1.md", "hook2.md"],
				skills: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["hook:hook1", "hook:hook2"])
		})

		it("should scan .clinerules/skills/ directory correctly", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: [],
				workflows: [],
				hooks: [],
				skills: ["my-skill"],
			})
			// stat for SKILL.md inside the skill directory
			fsStatStub.withArgs(sinon.match(/my-skill[/\\]SKILL\.md$/)).resolves({ isFile: () => true })

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["skill:my-skill"])
		})

		it("should skip skill directories without SKILL.md", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: [],
				workflows: [],
				hooks: [],
				skills: ["valid-skill", "invalid-skill"],
			})
			fsStatStub.withArgs(sinon.match(/valid-skill[/\\]SKILL\.md$/)).resolves({ isFile: () => true })
			fsStatStub.withArgs(sinon.match(/invalid-skill[/\\]SKILL\.md$/)).rejects(new Error("ENOENT"))

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["skill:valid-skill"])
		})

		it("should extract prompt IDs from .md filenames", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: ["test-prompt.md", "another-prompt.md"],
				workflows: [],
				hooks: [],
				skills: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["rule:test-prompt", "rule:another-prompt"])
		})

		it("should ignore non-.md files", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: ["prompt.md", "readme.txt", ".DS_Store", "config.json"],
				workflows: [],
				hooks: [],
				skills: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["rule:prompt"])
		})

		it("should return combined list from all directories with type prefixes", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: ["rule1.md", "rule2.md"],
				workflows: ["workflow1.md"],
				hooks: ["hook1.md"],
				skills: ["skill1"],
			})
			fsStatStub.withArgs(sinon.match(/skill1[/\\]SKILL\.md$/)).resolves({ isFile: () => true })

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, [
				"rule:rule1",
				"rule:rule2",
				"workflow:workflow1",
				"hook:hook1",
				"skill:skill1",
			])
		})

		it("should not collide when rule and workflow share the same name", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: ["test-prompt.md"],
				workflows: ["test-prompt.md"],
				hooks: [],
				skills: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["rule:test-prompt", "workflow:test-prompt"])
			// Both should be present and distinct
			assert.strictEqual(result.values.length, 2)
		})

		it("should handle empty directories", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: [],
				workflows: [],
				hooks: [],
				skills: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, [])
		})
	})

	describe("Error Handling", () => {
		it("should gracefully handle missing .clinerules/ directory", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				workflows: ["workflow.md"],
				hooks: [],
				skills: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["workflow:workflow"])
		})

		it("should gracefully handle missing workflows/ directory", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: ["rule.md"],
				hooks: [],
				skills: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["rule:rule"])
		})

		it("should gracefully handle missing hooks/ directory", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: ["rule.md"],
				workflows: [],
				skills: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["rule:rule"])
		})

		it("should gracefully handle missing skills/ directory", async () => {
			getWorkspacePathStub.resolves("/workspace")
			stubDirectories({
				rules: ["rule.md"],
				workflows: [],
				hooks: [],
			})

			const result = await getAppliedPrompts(mockController, EmptyRequest.create({}))

			assert.deepStrictEqual(result.values, ["rule:rule"])
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
