/**
 * Unit tests for WorkspacePathAdapter
 * Tests the core functionality of path resolution in single and multi-root workspaces
 */

import { VcsType, WorkspaceRoot } from "@shared/multi-root/types"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as path from "path"
import * as sinon from "sinon"
import { createWorkspacePathAdapter, WorkspacePathAdapter } from "../WorkspacePathAdapter"
import { WorkspaceRootManager } from "../WorkspaceRootManager"
import "@utils/path"

describe("WorkspacePathAdapter", () => {
	let consoleWarnStub: sinon.SinonStub

	beforeEach(() => {
		consoleWarnStub = sinon.stub(console, "warn")
	})

	afterEach(() => {
		consoleWarnStub.restore()
	})

	describe("Single-Root Mode", () => {
		const testCwd = "/test/workspace"
		let adapter: WorkspacePathAdapter

		beforeEach(() => {
			adapter = new WorkspacePathAdapter({
				cwd: testCwd,
				isMultiRootEnabled: false,
			})
		})

		it("should resolve relative paths", () => {
			const result = adapter.resolvePath("src/file.ts")
			expect(result).to.equal(path.resolve(testCwd, "src/file.ts"))
		})

		it("should handle absolute paths", () => {
			const absolutePath = "/absolute/path/file.ts"
			const result = adapter.resolvePath(absolutePath)
			expect(result).to.equal(path.resolve(testCwd, absolutePath))
		})

		it("should get workspace for path within cwd", () => {
			const workspace = adapter.getWorkspaceForPath("/test/workspace/src/file.ts")
			expect(workspace).to.deep.equal({
				name: "workspace",
				path: testCwd,
			})
		})

		it("should return undefined for path outside cwd", () => {
			const workspace = adapter.getWorkspaceForPath("/other/path/file.ts")
			expect(workspace).to.be.undefined
		})

		it("should get relative path from cwd", () => {
			const result = adapter.getRelativePath("/test/workspace/src/file.ts")
			expect(result.toPosix()).to.equal("src/file.ts")
		})

		it("should return single workspace root", () => {
			const roots = adapter.getWorkspaceRoots()
			expect(roots).to.have.length(1)
			expect(roots[0]).to.deep.equal({
				name: "workspace",
				path: testCwd,
			})
		})

		it("should report multi-root as disabled", () => {
			expect(adapter.isMultiRootEnabled()).to.be.false
		})
	})

	describe("Multi-Root Mode", () => {
		const roots: WorkspaceRoot[] = [
			{ path: "/workspace/frontend", name: "frontend", vcs: VcsType.Git },
			{ path: "/workspace/backend", name: "backend", vcs: VcsType.Git },
			{ path: "/workspace/shared", name: "shared", vcs: VcsType.None },
		]
		let adapter: WorkspacePathAdapter
		let mockManager: WorkspaceRootManager

		beforeEach(() => {
			mockManager = new WorkspaceRootManager(roots, 0)
			adapter = new WorkspacePathAdapter({
				cwd: "/workspace/frontend",
				isMultiRootEnabled: true,
				workspaceManager: mockManager,
			})
		})

		it("should resolve path with workspace hint by name", () => {
			const result = adapter.resolvePath("src/index.ts", "backend")
			expect(result.toPosix()).to.equal("/workspace/backend/src/index.ts")
		})

		it("should resolve path with workspace hint by path", () => {
			const result = adapter.resolvePath("src/index.ts", "/workspace/shared")
			expect(result.toPosix()).to.equal("/workspace/shared/src/index.ts")
		})

		it("should default to primary workspace without hint", () => {
			const result = adapter.resolvePath("src/index.ts")
			expect(result.toPosix()).to.equal("/workspace/frontend/src/index.ts")
		})

		it("should handle absolute paths belonging to a workspace", () => {
			const absolutePath = "/workspace/backend/src/api.ts"
			const result = adapter.resolvePath(absolutePath)
			expect(result).to.equal(absolutePath)
		})

		it("should warn for absolute paths outside workspaces", () => {
			const absolutePath = "/other/path/file.ts"
			const result = adapter.resolvePath(absolutePath)

			expect(result).to.equal(absolutePath)
			expect(consoleWarnStub.calledOnce).to.be.true
			expect(consoleWarnStub.firstCall.args[0]).to.include("doesn't belong to any workspace")
		})

		it("should get all possible paths across workspaces", () => {
			const paths = adapter.getAllPossiblePaths("src/config.ts")
			expect(paths).to.have.length(3)
			// Normalize each path for cross-platform comparison
			const normalizedPaths = paths.map((p) => p.toPosix())
			expect(normalizedPaths).to.deep.equal([
				"/workspace/frontend/src/config.ts",
				"/workspace/backend/src/config.ts",
				"/workspace/shared/src/config.ts",
			])
		})

		it("should identify workspace for path", () => {
			const workspace = adapter.getWorkspaceForPath("/workspace/backend/src/api.ts")
			expect(workspace).to.deep.equal({
				name: "backend",
				path: "/workspace/backend",
			})
		})

		it("should get relative path from appropriate workspace", () => {
			const result = adapter.getRelativePath("/workspace/backend/src/api.ts")
			expect(result.toPosix()).to.equal("src/api.ts")
		})

		it("should return all workspace roots", () => {
			const workspaceRoots = adapter.getWorkspaceRoots()
			expect(workspaceRoots).to.have.length(3)
			expect(workspaceRoots[0].name).to.equal("frontend")
			expect(workspaceRoots[1].name).to.equal("backend")
			expect(workspaceRoots[2].name).to.equal("shared")
		})

		it("should get primary workspace", () => {
			const primary = adapter.getPrimaryWorkspace()
			expect(primary).to.deep.equal({
				name: "frontend",
				path: "/workspace/frontend",
			})
		})

		it("should warn for invalid workspace hint", () => {
			const result = adapter.resolvePath("src/file.ts", "nonexistent")

			expect(result.toPosix()).to.equal("/workspace/frontend/src/file.ts") // Falls back to primary
			expect(consoleWarnStub.calledOnce).to.be.true
			expect(consoleWarnStub.firstCall.args[0]).to.include("not found")
		})
	})

	describe("Edge Cases", () => {
		it("should handle empty workspace manager gracefully", () => {
			const mockManager = new WorkspaceRootManager([], 0)
			const adapter = new WorkspacePathAdapter({
				cwd: "/fallback",
				isMultiRootEnabled: true,
				workspaceManager: mockManager,
			})

			const result = adapter.resolvePath("src/file.ts")
			expect(result.toPosix()).to.include("/fallback/src/file.ts")
			expect(consoleWarnStub.called).to.be.true
		})

		it("should handle paths with special characters", () => {
			const adapter = new WorkspacePathAdapter({
				cwd: "/test/workspace",
				isMultiRootEnabled: false,
			})

			const specialPath = "src/file with spaces & symbols!.ts"
			const result = adapter.resolvePath(specialPath)
			expect(result).to.equal(path.resolve("/test/workspace", specialPath))
		})
	})

	describe("Factory Function", () => {
		it("should create adapter using factory function", () => {
			const adapter = createWorkspacePathAdapter({
				cwd: "/test/workspace",
				isMultiRootEnabled: false,
			})

			expect(adapter).to.be.instanceOf(WorkspacePathAdapter)
			expect(adapter.isMultiRootEnabled()).to.be.false
		})
	})
})
