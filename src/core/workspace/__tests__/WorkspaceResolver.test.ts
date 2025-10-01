/**
 * Unit tests for WorkspaceResolver
 * These tests ensure behavior preservation during refactoring
 */

import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as path from "path"
import * as sinon from "sinon"
import { Logger } from "../../../services/logging/Logger"
import { WorkspaceResolver } from "../WorkspaceResolver"
import { VcsType, WorkspaceRoot } from "../WorkspaceRoot"

describe("WorkspaceResolver", () => {
	let resolver: WorkspaceResolver
	let loggerStub: sinon.SinonStub
	let originalEnv: string | undefined

	beforeEach(() => {
		resolver = new WorkspaceResolver()
		loggerStub = sinon.stub(Logger, "debug")
		originalEnv = process.env.MULTI_ROOT_TRACE
	})

	afterEach(() => {
		loggerStub.restore()
		process.env.MULTI_ROOT_TRACE = originalEnv
		resolver.clearUsageStats()
	})

	describe("resolveWorkspacePath - Single Root Mode", () => {
		const testCwd = "/test/workspace"
		const testRelativePath = "src/file.ts"
		const expectedAbsolutePath = path.resolve(testCwd, testRelativePath)

		it("should resolve path without context", () => {
			const result = resolver.resolveWorkspacePath(testCwd, testRelativePath)
			expect(result).to.equal(expectedAbsolutePath)
		})

		it("should resolve path with context and track usage", () => {
			const context = "TestComponent"
			const result = resolver.resolveWorkspacePath(testCwd, testRelativePath, context)

			expect(result).to.equal(expectedAbsolutePath)

			// Verify usage tracking
			const usageStats = resolver.getUsageStats()
			expect(usageStats.has(context)).to.be.true

			const stats = usageStats.get(context)!
			expect(stats.count).to.equal(1)
			expect(stats.examples).to.include(testRelativePath)
		})

		it("should track multiple calls to same context", () => {
			const context = "TestComponent"

			resolver.resolveWorkspacePath(testCwd, "file1.ts", context)
			resolver.resolveWorkspacePath(testCwd, "file2.ts", context)
			resolver.resolveWorkspacePath(testCwd, "file1.ts", context) // duplicate

			const usageStats = resolver.getUsageStats()
			const stats = usageStats.get(context)!

			expect(stats.count).to.equal(3)
			expect(stats.examples).to.have.length(2) // no duplicates in examples
			expect(stats.examples).to.include("file1.ts")
			expect(stats.examples).to.include("file2.ts")
		})

		it("should not log when tracing is disabled", () => {
			process.env.MULTI_ROOT_TRACE = "false"
			process.env.NODE_ENV = "production"

			resolver.resolveWorkspacePath(testCwd, testRelativePath, "TestComponent")

			expect(loggerStub.called).to.be.false
		})

		it("should handle absolute paths correctly", () => {
			const absolutePath = "/absolute/path/file.ts"
			const result = resolver.resolveWorkspacePath(testCwd, absolutePath)

			expect(result).to.equal(path.resolve(testCwd, absolutePath))
		})

		it("should handle empty relative path", () => {
			const result = resolver.resolveWorkspacePath(testCwd, "")
			expect(result).to.equal(path.resolve(testCwd))
		})

		it("should handle relative paths with .. navigation", () => {
			const relativePath = "../other/file.ts"
			const result = resolver.resolveWorkspacePath(testCwd, relativePath)
			expect(result).to.equal(path.resolve(testCwd, relativePath))
		})
	})

	describe("resolveWorkspacePath - Multi Root Mode", () => {
		const workspaceRoots: WorkspaceRoot[] = [
			{ path: "/workspace/primary", name: "primary", vcs: VcsType.Git },
			{ path: "/workspace/secondary", name: "secondary", vcs: VcsType.Git },
		]

		it("should handle absolute paths in multi-root mode", () => {
			const absolutePath = "/workspace/primary/src/file.ts"
			const result = resolver.resolveWorkspacePath(workspaceRoots, absolutePath)

			expect(result).to.be.an("object")
			expect((result as any).absolutePath).to.equal(absolutePath)
			expect((result as any).root).to.equal(workspaceRoots[0])
		})

		it("should fallback to primary root for unmatched absolute paths", () => {
			const absolutePath = "/other/path/file.ts"
			const result = resolver.resolveWorkspacePath(workspaceRoots, absolutePath)

			expect(result).to.be.an("object")
			expect((result as any).absolutePath).to.equal(absolutePath)
			expect((result as any).root).to.equal(workspaceRoots[0])
		})

		it("should resolve relative paths against primary root", () => {
			const relativePath = "src/file.ts"
			const result = resolver.resolveWorkspacePath(workspaceRoots, relativePath)

			expect(result).to.be.an("object")
			expect((result as any).absolutePath).to.equal(path.resolve(workspaceRoots[0].path, relativePath))
			expect((result as any).root).to.equal(workspaceRoots[0])
		})

		it("should handle empty workspace roots array", () => {
			// This should throw an error or handle gracefully
			expect(() => {
				resolver.resolveWorkspacePath([], "src/file.ts")
			}).to.throw()
		})
	})

	describe("getBasename", () => {
		const testFilePath = "/path/to/file.ts"
		const expectedBasename = "file.ts"

		it("should return basename without context", () => {
			const result = resolver.getBasename(testFilePath)
			expect(result).to.equal(expectedBasename)
		})

		it("should return basename with context and track usage", () => {
			const context = "TestComponent"
			const result = resolver.getBasename(testFilePath, context)

			expect(result).to.equal(expectedBasename)

			// Verify usage tracking
			const usageStats = resolver.getUsageStats()
			expect(usageStats.has(context)).to.be.true

			const stats = usageStats.get(context)!
			expect(stats.count).to.equal(1)
			expect(stats.examples).to.include(testFilePath)
		})
	})

	describe("Usage Statistics Management", () => {
		it("should track usage statistics correctly", () => {
			resolver.resolveWorkspacePath("/test", "file1.ts", "Component1")
			resolver.resolveWorkspacePath("/test", "file2.ts", "Component1")
			resolver.getBasename("/test/file3.ts", "Component2")

			const usageStats = resolver.getUsageStats()
			expect(usageStats.size).to.equal(2)

			const component1Stats = usageStats.get("Component1")!
			expect(component1Stats.count).to.equal(2)
			expect(component1Stats.examples).to.have.length(2)

			const component2Stats = usageStats.get("Component2")!
			expect(component2Stats.count).to.equal(1)
			expect(component2Stats.examples).to.have.length(1)
		})
	})

	describe("Edge Cases", () => {
		it("should handle null/undefined inputs gracefully", () => {
			// These should not throw
			expect(() => resolver.resolveWorkspacePath("/test", "")).to.not.throw()
			expect(() => resolver.getBasename("")).to.not.throw()
		})

		it("should handle special characters in paths", () => {
			const specialPath = "src/file with spaces & symbols!.ts"
			const result = resolver.resolveWorkspacePath("/test", specialPath, "Component")

			expect(result).to.equal(path.resolve("/test", specialPath))
		})

		it("should handle very long paths", () => {
			const longPath = "a/".repeat(100) + "file.ts"
			const result = resolver.resolveWorkspacePath("/test", longPath, "Component")

			expect(result).to.equal(path.resolve("/test", longPath))
		})
	})
})
