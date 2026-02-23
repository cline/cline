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
 * Integration tests for hook management
 * Tests the complete lifecycle: create -> enable -> disable -> delete
 */
describe("Hook Management Integration", () => {
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
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-integration-test-"))
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

	describe("Complete Hook Lifecycle", () => {
		it("should support full lifecycle: create -> verify disabled -> enable -> verify enabled -> delete -> verify gone", async function () {
			this.timeout(10000)

			const hookName = "TaskStart"

			// Step 1: Verify hook doesn't exist initially
			let hooks = await refreshHooks(mockController, undefined, globalHooksDir)
			hooks.globalHooks.should.have.length(0)

			// Step 2: Create the hook
			const createRequest = CreateHookRequest.create({
				hookName,
				isGlobal: true,
			})
			const createResponse = await createHook(mockController, createRequest, globalHooksDir)

			// Step 3: Verify hook was created and is disabled (644 permissions)
			createResponse.hooksToggles!.globalHooks.should.have.length(1)
			createResponse.hooksToggles!.globalHooks[0].name.should.equal(hookName)
			createResponse.hooksToggles!.globalHooks[0].enabled.should.equal(false)

			const hookPath = path.join(globalHooksDir, hookName)
			const createStats = await fs.stat(hookPath)
			const createMode = createStats.mode & 0o777
			createMode.should.equal(0o644)

			// Step 4: Enable the hook
			const enableRequest = ToggleHookRequest.create({
				hookName,
				isGlobal: true,
				enabled: true,
			})
			const enableResponse = await toggleHook(mockController, enableRequest, globalHooksDir)

			// Step 5: Verify hook is now enabled (executable)
			enableResponse.hooksToggles!.globalHooks.should.have.length(1)
			enableResponse.hooksToggles!.globalHooks[0].enabled.should.equal(true)

			const enableStats = await fs.stat(hookPath)
			const enableMode = enableStats.mode & 0o777
			;(enableMode & 0o100).should.be.greaterThan(0)

			// Step 6: Disable the hook
			const disableRequest = ToggleHookRequest.create({
				hookName,
				isGlobal: true,
				enabled: false,
			})
			const disableResponse = await toggleHook(mockController, disableRequest, globalHooksDir)

			// Step 7: Verify hook is now disabled again
			disableResponse.hooksToggles!.globalHooks.should.have.length(1)
			disableResponse.hooksToggles!.globalHooks[0].enabled.should.equal(false)

			const disableStats = await fs.stat(hookPath)
			const disableMode = disableStats.mode & 0o777
			disableMode.should.equal(0o644)

			// Step 8: Delete the hook
			const deleteRequest = DeleteHookRequest.create({
				hookName,
				isGlobal: true,
			})
			const deleteResponse = await deleteHook(mockController, deleteRequest, globalHooksDir)

			// Step 9: Verify hook is gone
			deleteResponse.hooksToggles!.globalHooks.should.have.length(0)

			const hookExists = await fs
				.access(hookPath)
				.then(() => true)
				.catch(() => false)
			hookExists.should.equal(false)

			// Step 10: Final refresh to confirm clean state
			hooks = await refreshHooks(mockController, undefined, globalHooksDir)
			hooks.globalHooks.should.have.length(0)
		})

		it("should handle multiple global hooks with independent states", async function () {
			this.timeout(10000)

			// Create four global hooks
			await createHook(
				mockController,
				CreateHookRequest.create({
					hookName: "TaskStart",
					isGlobal: true,
				}),
				globalHooksDir,
			)

			await createHook(
				mockController,
				CreateHookRequest.create({
					hookName: "TaskResume",
					isGlobal: true,
				}),
				globalHooksDir,
			)

			await createHook(
				mockController,
				CreateHookRequest.create({
					hookName: "UserPromptSubmit",
					isGlobal: true,
				}),
				globalHooksDir,
			)

			await createHook(
				mockController,
				CreateHookRequest.create({
					hookName: "TaskComplete",
					isGlobal: true,
				}),
				globalHooksDir,
			)

			// Verify all hooks are present and disabled
			const hooks = await refreshHooks(mockController, undefined, globalHooksDir)
			hooks.globalHooks.should.have.length(4)
			hooks.globalHooks.forEach((hook) => {
				hook.enabled.should.equal(false)
			})

			// Enable two of them
			await toggleHook(
				mockController,
				ToggleHookRequest.create({
					hookName: "TaskStart",
					isGlobal: true,
					enabled: true,
				}),
				globalHooksDir,
			)

			await toggleHook(
				mockController,
				ToggleHookRequest.create({
					hookName: "UserPromptSubmit",
					isGlobal: true,
					enabled: true,
				}),
				globalHooksDir,
			)

			// Verify states are independent
			const hooksAfterToggle = await refreshHooks(mockController, undefined, globalHooksDir)
			const taskStart = hooksAfterToggle.globalHooks.find((h) => h.name === "TaskStart")
			const taskResume = hooksAfterToggle.globalHooks.find((h) => h.name === "TaskResume")
			const userPrompt = hooksAfterToggle.globalHooks.find((h) => h.name === "UserPromptSubmit")
			const taskComplete = hooksAfterToggle.globalHooks.find((h) => h.name === "TaskComplete")

			taskStart!.enabled.should.equal(true)
			taskResume!.enabled.should.equal(false)
			userPrompt!.enabled.should.equal(true)
			taskComplete!.enabled.should.equal(false)

			// Clean up - delete all hooks
			await deleteHook(
				mockController,
				DeleteHookRequest.create({
					hookName: "TaskStart",
					isGlobal: true,
				}),
				globalHooksDir,
			)

			await deleteHook(
				mockController,
				DeleteHookRequest.create({
					hookName: "TaskResume",
					isGlobal: true,
				}),
				globalHooksDir,
			)

			await deleteHook(
				mockController,
				DeleteHookRequest.create({
					hookName: "UserPromptSubmit",
					isGlobal: true,
				}),
				globalHooksDir,
			)

			await deleteHook(
				mockController,
				DeleteHookRequest.create({
					hookName: "TaskComplete",
					isGlobal: true,
				}),
				globalHooksDir,
			)

			// Verify all are gone
			const finalHooks = await refreshHooks(mockController, undefined, globalHooksDir)
			finalHooks.globalHooks.should.have.length(0)
		})

		it("should maintain hook state consistency after rapid operations", async function () {
			this.timeout(10000)

			const hookName = "TaskCancel"

			// Rapid sequence of operations
			await createHook(
				mockController,
				CreateHookRequest.create({
					hookName,
					isGlobal: true,
				}),
				globalHooksDir,
			)

			// Toggle multiple times
			await toggleHook(
				mockController,
				ToggleHookRequest.create({
					hookName,
					isGlobal: true,
					enabled: true,
				}),
				globalHooksDir,
			)

			await toggleHook(
				mockController,
				ToggleHookRequest.create({
					hookName,
					isGlobal: true,
					enabled: false,
				}),
				globalHooksDir,
			)

			await toggleHook(
				mockController,
				ToggleHookRequest.create({
					hookName,
					isGlobal: true,
					enabled: true,
				}),
				globalHooksDir,
			)

			// Verify final state
			const hooks = await refreshHooks(mockController, undefined, globalHooksDir)
			hooks.globalHooks.should.have.length(1)
			hooks.globalHooks[0].enabled.should.equal(true)

			// Verify file permissions match
			const hookPath = path.join(globalHooksDir, hookName)
			const stats = await fs.stat(hookPath)
			const mode = stats.mode & 0o777
			;(mode & 0o100).should.be.greaterThan(0)
		})
	})

	describe("Cache Invalidation", () => {
		it("should properly invalidate cache across all operations", async function () {
			this.timeout(10000)

			// Create a hook
			await createHook(
				mockController,
				CreateHookRequest.create({
					hookName: "TaskStart",
					isGlobal: true,
				}),
				globalHooksDir,
			)

			// First refresh should find it
			let hooks = await refreshHooks(mockController, undefined, globalHooksDir)
			hooks.globalHooks.should.have.length(1)

			// Modify file permissions directly (simulating external change)
			const hookPath = path.join(globalHooksDir, "TaskStart")
			await fs.chmod(hookPath, 0o755)

			// Second refresh should see the permission change
			// (This tests that refreshHooks properly reads current state)
			hooks = await refreshHooks(mockController, undefined, globalHooksDir)
			hooks.globalHooks[0].enabled.should.equal(true)

			// Use toggle to change it back
			await toggleHook(
				mockController,
				ToggleHookRequest.create({
					hookName: "TaskStart",
					isGlobal: true,
					enabled: false,
				}),
				globalHooksDir,
			)

			// Third refresh should see the toggle
			hooks = await refreshHooks(mockController, undefined, globalHooksDir)
			hooks.globalHooks[0].enabled.should.equal(false)

			// Delete it
			await deleteHook(
				mockController,
				DeleteHookRequest.create({
					hookName: "TaskStart",
					isGlobal: true,
				}),
				globalHooksDir,
			)

			// Final refresh should show it's gone
			hooks = await refreshHooks(mockController, undefined, globalHooksDir)
			hooks.globalHooks.should.have.length(0)
		})
	})
})
