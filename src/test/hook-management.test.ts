import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as sinon from "sinon"
import { Controller } from "../core/controller"
import { createHook } from "../core/controller/file/createHook"
import { deleteHook } from "../core/controller/file/deleteHook"
import { refreshHooks } from "../core/controller/file/refreshHooks"
import { toggleHook } from "../core/controller/file/toggleHook"
import { HookDiscoveryCache } from "../core/hooks/HookDiscoveryCache"
import { StateManager } from "../core/storage/StateManager"
import { HostProvider } from "../hosts/host-provider"
import { CreateHookRequest, DeleteHookRequest, ToggleHookRequest } from "../shared/proto/cline/file"

/**
 * Unit tests for hook management operations
 * Tests the create, delete, toggle, and refresh hook functionality
 */
describe("Hook Management", () => {
	// Skip all hook tests on Windows as hooks are not yet supported on that platform
	if (process.platform === "win32") {
		it.skip("Hook tests are not supported on Windows yet", () => {
			// This is intentional - hooks will be implemented for Windows in a future release
		})
		return
	}

	let tempDir: string
	let globalHooksDir: string
	let workspaceHooksDir: string
	let mockController: Controller
	let stateManagerStub: sinon.SinonStub
	let getWorkspacePathsStub: sinon.SinonStub

	beforeEach(async () => {
		// Reset the hook discovery cache before each test
		HookDiscoveryCache.resetForTesting()

		// Create temporary directories
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-mgmt-test-"))
		globalHooksDir = path.join(tempDir, "global", "Documents", "Cline", "Hooks")
		workspaceHooksDir = path.join(tempDir, "workspace", ".clinerules", "hooks")

		await fs.mkdir(globalHooksDir, { recursive: true })
		await fs.mkdir(workspaceHooksDir, { recursive: true })

		// Mock Controller
		mockController = {
			context: {
				globalStorageUri: { fsPath: path.join(tempDir, "global") },
			},
		} as any

		// Mock StateManager to return test workspace
		stateManagerStub = sinon.stub(StateManager, "get").returns({
			getGlobalStateKey: (key: string) => {
				if (key === "workspaceRoots") {
					return [{ path: path.join(tempDir, "workspace") }]
				}
				return undefined
			},
		} as any)

		// Mock HostProvider.workspace.getWorkspacePaths - need to stub the method directly
		getWorkspacePathsStub = sinon.stub().resolves({
			paths: [path.join(tempDir, "workspace")],
		})
		sinon.stub(HostProvider, "workspace").value({
			getWorkspacePaths: getWorkspacePathsStub,
		})
	})

	afterEach(async () => {
		// Clean up temporary directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors
		}

		// Restore all stubs
		sinon.restore()
	})

	describe("createHook", () => {
		it("should create hook with correct template content", async function () {
			this.timeout(5000)

			const request = CreateHookRequest.create({
				hookName: "TaskStart",
				isGlobal: true,
			})

			const response = await createHook(mockController, request, globalHooksDir)

			// Verify file was created
			const hookPath = path.join(globalHooksDir, "TaskStart")
			const exists = await fs
				.access(hookPath)
				.then(() => true)
				.catch(() => false)
			exists.should.equal(true)

			// Verify content contains expected template structure
			const content = await fs.readFile(hookPath, "utf-8")
			content.should.containEql("#!/bin/bash")
			content.should.containEql("TaskStart Hook")

			// Verify response contains updated hooks state
			response.should.have.property("hooksToggles")
			response.hooksToggles!.globalHooks.should.have.length(1)
			response.hooksToggles!.globalHooks[0].name.should.equal("TaskStart")
		})

		it("should create hook with non-executable permissions (644)", async function () {
			this.timeout(5000)

			const request = CreateHookRequest.create({
				hookName: "TaskResume",
				isGlobal: false,
			})

			await createHook(mockController, request)

			const hookPath = path.join(workspaceHooksDir, "TaskResume")
			const stats = await fs.stat(hookPath)

			// Check permissions - should be 0o644 (non-executable)
			const mode = stats.mode & 0o777
			mode.should.equal(0o644)
		})

		it("should throw error for invalid hook types", async function () {
			this.timeout(5000)

			const request = CreateHookRequest.create({
				hookName: "InvalidHookType",
				isGlobal: true,
			})

			try {
				await createHook(mockController, request, globalHooksDir)
				throw new Error("Should have thrown an error")
			} catch (error: any) {
				error.message.should.containEql("Invalid hook type")
			}
		})

		it("should throw error if hook already exists", async function () {
			this.timeout(5000)

			// Create hook first time
			const request = CreateHookRequest.create({
				hookName: "UserPromptSubmit",
				isGlobal: true,
			})

			await createHook(mockController, request, globalHooksDir)

			// Try to create again
			try {
				await createHook(mockController, request, globalHooksDir)
				throw new Error("Should have thrown an error")
			} catch (error: any) {
				error.message.should.containEql("already exists")
			}
		})

		it("should create parent directories if they don't exist", async function () {
			this.timeout(5000)

			// Remove the hooks directory
			await fs.rm(globalHooksDir, { recursive: true, force: true })

			const request = CreateHookRequest.create({
				hookName: "TaskComplete",
				isGlobal: true,
			})

			await createHook(mockController, request, globalHooksDir)

			// Verify directory was created
			const dirExists = await fs
				.access(globalHooksDir)
				.then(() => true)
				.catch(() => false)
			dirExists.should.equal(true)

			// Verify hook was created
			const hookPath = path.join(globalHooksDir, "TaskComplete")
			const fileExists = await fs
				.access(hookPath)
				.then(() => true)
				.catch(() => false)
			fileExists.should.equal(true)
		})

		it("should create workspace hook when isGlobal is false", async function () {
			this.timeout(5000)

			const request = CreateHookRequest.create({
				hookName: "TaskCancel",
				isGlobal: false,
			})

			await createHook(mockController, request)

			const hookPath = path.join(workspaceHooksDir, "TaskCancel")
			const exists = await fs
				.access(hookPath)
				.then(() => true)
				.catch(() => false)
			exists.should.equal(true)
		})
	})

	describe("deleteHook", () => {
		it("should delete existing hook file", async function () {
			this.timeout(5000)

			// Create a hook first
			const hookPath = path.join(globalHooksDir, "TaskStart")
			await fs.writeFile(hookPath, "#!/usr/bin/env node\nconsole.log('test')", { mode: 0o755 })

			const request = DeleteHookRequest.create({
				hookName: "TaskStart",
				isGlobal: true,
			})

			const response = await deleteHook(mockController, request, globalHooksDir)

			// Verify file was deleted
			const exists = await fs
				.access(hookPath)
				.then(() => true)
				.catch(() => false)
			exists.should.equal(false)

			// Verify response contains updated hooks state
			response.should.have.property("hooksToggles")
			response.hooksToggles!.globalHooks.should.have.length(0)
		})

		it("should throw error if hook doesn't exist", async function () {
			this.timeout(5000)

			const request = DeleteHookRequest.create({
				hookName: "NonExistentHook",
				isGlobal: true,
			})

			try {
				await deleteHook(mockController, request, globalHooksDir)
				throw new Error("Should have thrown an error")
			} catch (error: any) {
				error.message.should.containEql("does not exist")
			}
		})

		it("should delete workspace hook when isGlobal is false", async function () {
			this.timeout(5000)

			// Create a workspace hook first
			const hookPath = path.join(workspaceHooksDir, "TaskResume")
			await fs.writeFile(hookPath, "#!/usr/bin/env node\nconsole.log('test')", { mode: 0o755 })

			const request = DeleteHookRequest.create({
				hookName: "TaskResume",
				isGlobal: false,
			})

			await deleteHook(mockController, request)

			const exists = await fs
				.access(hookPath)
				.then(() => true)
				.catch(() => false)
			exists.should.equal(false)
		})
	})

	describe("toggleHook", () => {
		it("should make hook executable (chmod +x)", async function () {
			this.timeout(5000)

			// Create a non-executable hook
			const hookPath = path.join(globalHooksDir, "TaskStart")
			await fs.writeFile(hookPath, "#!/usr/bin/env node\nconsole.log('test')", { mode: 0o644 })

			const request = ToggleHookRequest.create({
				hookName: "TaskStart",
				isGlobal: true,
				enabled: true,
			})

			await toggleHook(mockController, request, globalHooksDir)

			// Verify file is now executable
			const stats = await fs.stat(hookPath)
			const mode = stats.mode & 0o777
			// Should have at least user execute permission
			;(mode & 0o100).should.be.greaterThan(0)
		})

		it("should make hook non-executable (chmod -x)", async function () {
			this.timeout(5000)

			// Create an executable hook
			const hookPath = path.join(globalHooksDir, "TaskResume")
			await fs.writeFile(hookPath, "#!/usr/bin/env node\nconsole.log('test')", { mode: 0o755 })

			const request = ToggleHookRequest.create({
				hookName: "TaskResume",
				isGlobal: true,
				enabled: false,
			})

			await toggleHook(mockController, request, globalHooksDir)

			// Verify file is now non-executable
			const stats = await fs.stat(hookPath)
			const mode = stats.mode & 0o777
			mode.should.equal(0o644)
		})

		it("should work for workspace hooks", async function () {
			this.timeout(5000)

			// Create a workspace hook
			const hookPath = path.join(workspaceHooksDir, "UserPromptSubmit")
			await fs.writeFile(hookPath, "#!/usr/bin/env node\nconsole.log('test')", { mode: 0o644 })

			const request = ToggleHookRequest.create({
				hookName: "UserPromptSubmit",
				isGlobal: false,
				enabled: true,
			})

			await toggleHook(mockController, request)

			const stats = await fs.stat(hookPath)
			const mode = stats.mode & 0o777
			;(mode & 0o100).should.be.greaterThan(0)
		})

		it("should return updated hooks state", async function () {
			this.timeout(5000)

			const hookPath = path.join(globalHooksDir, "TaskComplete")
			await fs.writeFile(hookPath, "#!/usr/bin/env node\nconsole.log('test')", { mode: 0o644 })

			const request = ToggleHookRequest.create({
				hookName: "TaskComplete",
				isGlobal: true,
				enabled: true,
			})

			const response = await toggleHook(mockController, request, globalHooksDir)

			response.should.have.property("hooksToggles")
			response.hooksToggles!.globalHooks.should.have.length(1)
			response.hooksToggles!.globalHooks[0].enabled.should.equal(true)
		})
	})

	describe("refreshHooks", () => {
		it("should discover hooks in global directory", async function () {
			this.timeout(5000)

			// Create some hooks
			await fs.writeFile(path.join(globalHooksDir, "TaskStart"), "#!/usr/bin/env node", { mode: 0o755 })
			await fs.writeFile(path.join(globalHooksDir, "TaskResume"), "#!/usr/bin/env node", { mode: 0o644 })

			const result = await refreshHooks(mockController, undefined, globalHooksDir)

			result.globalHooks.should.have.length(2)
			result.globalHooks[0].name.should.equal("TaskStart")
			result.globalHooks[0].enabled.should.equal(true)
			result.globalHooks[1].name.should.equal("TaskResume")
			result.globalHooks[1].enabled.should.equal(false)
		})

		it("should discover hooks in workspace directories", async function () {
			this.timeout(5000)

			await fs.writeFile(path.join(workspaceHooksDir, "UserPromptSubmit"), "#!/usr/bin/env node", {
				mode: 0o755,
			})

			const result = await refreshHooks(mockController, undefined)

			result.workspaceHooks.should.have.length(1)
			result.workspaceHooks[0].hooks.should.have.length(1)
			result.workspaceHooks[0].hooks[0].name.should.equal("UserPromptSubmit")
			result.workspaceHooks[0].hooks[0].enabled.should.equal(true)
		})

		it("should correctly identify executable vs non-executable hooks", async function () {
			this.timeout(5000)

			await fs.writeFile(path.join(globalHooksDir, "TaskStart"), "#!/usr/bin/env node", { mode: 0o755 })
			await fs.writeFile(path.join(globalHooksDir, "TaskCancel"), "#!/usr/bin/env node", { mode: 0o644 })

			const result = await refreshHooks(mockController, undefined, globalHooksDir)

			const taskStart = result.globalHooks.find((h) => h.name === "TaskStart")
			const taskCancel = result.globalHooks.find((h) => h.name === "TaskCancel")

			taskStart!.enabled.should.equal(true)
			taskCancel!.enabled.should.equal(false)
		})

		it("should return empty list when no hooks exist", async function () {
			this.timeout(5000)

			const result = await refreshHooks(mockController, undefined, globalHooksDir)

			result.globalHooks.should.have.length(0)
			// Workspace should still appear even with no hooks
			result.workspaceHooks.should.have.length(1)
			result.workspaceHooks[0].hooks.should.have.length(0)
		})

		it("should include absolute paths in hook info", async function () {
			this.timeout(5000)

			await fs.writeFile(path.join(globalHooksDir, "TaskComplete"), "#!/usr/bin/env node", { mode: 0o755 })

			const result = await refreshHooks(mockController, undefined, globalHooksDir)

			result.globalHooks[0].absolutePath.should.equal(path.join(globalHooksDir, "TaskComplete"))
		})

		it("should set isWindows flag correctly", async function () {
			this.timeout(5000)

			const result = await refreshHooks(mockController, undefined)

			// Should be false on non-Windows platforms
			result.isWindows.should.equal(false)
		})
	})

	describe("Edge Cases", () => {
		it("should handle missing .clinerules directory gracefully", async function () {
			this.timeout(5000)

			// Remove workspace hooks directory
			await fs.rm(path.dirname(workspaceHooksDir), { recursive: true, force: true })

			const result = await refreshHooks(mockController, undefined)

			// Should not throw, just return empty workspace hooks
			result.workspaceHooks.should.have.length(1)
			result.workspaceHooks[0].hooks.should.have.length(0)
		})

		it("should handle permission errors gracefully", async function () {
			this.timeout(5000)

			// Create a hook
			const hookPath = path.join(globalHooksDir, "TaskStart")
			await fs.writeFile(hookPath, "#!/usr/bin/env node", { mode: 0o644 })

			// Make the hooks directory read-only on unix systems
			if (process.platform !== "win32") {
				await fs.chmod(globalHooksDir, 0o444)
			}

			const request = DeleteHookRequest.create({
				hookName: "TaskStart",
				isGlobal: true,
			})

			try {
				await deleteHook(mockController, request, globalHooksDir)
				// Should throw an error
			} catch (error) {
				// Expected - permission denied
			} finally {
				// Restore permissions for cleanup
				await fs.chmod(globalHooksDir, 0o755)
			}
		})

		it("should invalidate cache after hook operations", async function () {
			this.timeout(5000)

			// Create a hook
			const createRequest = CreateHookRequest.create({
				hookName: "TaskStart",
				isGlobal: true,
			})
			await createHook(mockController, createRequest, globalHooksDir)

			// Refresh should see the new hook
			let result = await refreshHooks(mockController, undefined, globalHooksDir)
			result.globalHooks.should.have.length(1)

			// Delete the hook
			const deleteRequest = DeleteHookRequest.create({
				hookName: "TaskStart",
				isGlobal: true,
			})
			await deleteHook(mockController, deleteRequest, globalHooksDir)

			// Refresh should no longer see the hook
			result = await refreshHooks(mockController, undefined, globalHooksDir)
			result.globalHooks.should.have.length(0)
		})
	})
})
