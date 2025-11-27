import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { StateManager } from "../../storage/StateManager"
import { HookFactory } from "../hook-factory"
import { loadFixture } from "./test-utils"

describe("TaskCancel Hook", () => {
	// These tests assume uniform executable script execution via embedded shell
	// Windows support pending embedded shell implementation
	before(function () {
		if (process.platform === "win32") {
			this.skip()
		}
	})

	let tempDir: string
	let sandbox: sinon.SinonSandbox
	let getEnv: () => { tempDir: string }

	// Helper to write executable hook script
	const writeHookScript = async (hookPath: string, nodeScript: string): Promise<void> => {
		await fs.writeFile(hookPath, nodeScript)
		await fs.chmod(hookPath, 0o755)
	}

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })

		// Create .clinerules/hooks directory
		const hooksDir = path.join(tempDir, ".clinerules", "hooks")
		await fs.mkdir(hooksDir, { recursive: true })

		// Mock StateManager to return our temp directory
		sandbox.stub(StateManager, "get").returns({
			getGlobalStateKey: () => [{ path: tempDir }],
		} as any)

		getEnv = () => ({ tempDir })

		// Reset hook discovery cache for clean test state
		const { HookDiscoveryCache } = await import("../HookDiscoveryCache")
		HookDiscoveryCache.resetForTesting()
	})

	afterEach(async () => {
		sandbox.restore()

		// Clean up hook discovery cache
		const { HookDiscoveryCache } = await import("../HookDiscoveryCache")
		HookDiscoveryCache.resetForTesting()

		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors
		}
	})

	describe("Hook Input Format", () => {
		it("should receive task metadata with completionStatus", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const metadata = input.taskCancel.taskMetadata;
const hasAllFields = metadata.taskId && metadata.ulid && metadata.completionStatus;
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasAllFields ? "Test passed" : "Missing metadata",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.false()
			// Note: contextModification is ignored for TaskCancel hooks
		})

		it("should handle 'abandoned' completion status", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const status = input.taskCancel.taskMetadata.completionStatus;
// Verify we can read the status (for logging purposes)
if (status !== "abandoned") {
  process.exit(1);
}
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "abandoned",
					},
				},
			})

			result.cancel.should.be.false()
			// Note: contextModification is ignored for TaskCancel hooks
		})

		it("should receive all common hook input fields", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasAllFields = input.clineVersion && input.hookName === 'TaskCancel' && 
                     input.timestamp && input.taskId && 
                     input.workspaceRoots !== undefined;
// Exit with error if fields are missing (for test verification)
if (!hasAllFields) {
  process.exit(1);
}
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.false()
			// Note: contextModification is ignored for TaskCancel hooks
		})
	})

	describe("Fire-and-Forget Behavior", () => {
		it("should ignore contextModification regardless of content", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "This is a context modification that should be ignored",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result1 = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			// Hook returns contextModification, but it's completely ignored (fire-and-forget)
			result1.cancel.should.be.false()
			result1.contextModification!.should.equal("This is a context modification that should be ignored")

			// Update hook to return different contextModification
			const hookScript2 = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Different context that is also ignored",
  errorMessage: ""
}))`
			await writeHookScript(hookPath, hookScript2)

			const result2 = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			// Both results behave identically - contextModification has no effect
			result2.cancel.should.be.false()
			result2.contextModification!.should.equal("Different context that is also ignored")
			// The key point: both executions succeeded with cancel: false
			// The contextModification value is different but behavior is identical (fire-and-forget)
		})

		it("should succeed regardless of hook return value", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
// Note: contextModification is ignored for TaskCancel hooks
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			// TaskCancel is fire-and-forget, so it always reports success
			result.cancel.should.be.false()
		})

		it("should return error message when hook returns cancel: true", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  contextModification: "",
  errorMessage: "Hook tried to block cancellation"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			// Hook result includes cancel: true and errorMessage
			// In abortTask(), the errorMessage will be surfaced to the user via this.say("error", ...)
			// but cancellation will still proceed (fire-and-forget behavior)
			result.cancel.should.be.true()
			result.errorMessage!.should.equal("Hook tried to block cancellation")
		})

		it("should execute without errors for cleanup purposes", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const status = input.taskCancel.taskMetadata.completionStatus;
// Hook can perform cleanup/logging based on status
// Note: contextModification is ignored for TaskCancel hooks
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.false()
		})
	})

	describe("Error Handling", () => {
		it("should surface hook errors to the user", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
console.error("Hook execution error");
process.exit(1);`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			// TaskCancel hook errors should throw (they will be caught and surfaced in abortTask)
			try {
				await runner.run({
					taskId: "test-task-id",
					taskCancel: {
						taskMetadata: {
							taskId: "test-task-id",
							ulid: "test-ulid",
							completionStatus: "cancelled",
						},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/TaskCancel.*exited with code 1/)
			}
		})

		it("should handle malformed JSON output from hook", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
console.log("not valid json")`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			// When hook exits 0 but has malformed JSON, it returns success without context
			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			// Hook succeeded (exit 0) but couldn't parse JSON, so returns success without context
			result.cancel.should.be.false()
			;(result.contextModification === undefined || result.contextModification === "").should.be.true()
		})
	})

	describe("Global and Workspace Hooks", () => {
		let globalHooksDir: string
		let originalGetAllHooksDirs: any

		beforeEach(async () => {
			// Create global hooks directory
			globalHooksDir = path.join(tempDir, "global-hooks")
			await fs.mkdir(globalHooksDir, { recursive: true })

			// Mock getAllHooksDirs to include our test global directory
			const diskModule = require("../../storage/disk")
			originalGetAllHooksDirs = diskModule.getAllHooksDirs
			sandbox.stub(diskModule, "getAllHooksDirs").callsFake(async () => {
				const workspaceDirs = await originalGetAllHooksDirs()
				return [globalHooksDir, ...workspaceDirs]
			})
		})

		it("should execute both global and workspace TaskCancel hooks", async () => {
			// Create global hook
			const globalHookPath = path.join(globalHooksDir, "TaskCancel")
			const globalHookScript = `#!/usr/bin/env node
// Note: contextModification is ignored for TaskCancel hooks
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			// Create workspace hook
			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const workspaceHookScript = `#!/usr/bin/env node
// Note: contextModification is ignored for TaskCancel hooks
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")
			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.false()
			// Both hooks executed successfully
		})

		it("should execute both hooks with different completion statuses", async () => {
			const globalHookPath = path.join(globalHooksDir, "TaskCancel")
			const globalHookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
// Can perform cleanup based on completion status
// Note: contextModification is ignored for TaskCancel hooks
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const workspaceHookScript = `#!/usr/bin/env node
// Note: contextModification is ignored for TaskCancel hooks
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")
			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "abandoned",
					},
				},
			})

			result.cancel.should.be.false()
			// Both hooks executed successfully
		})
	})

	describe("No Hook Behavior", () => {
		it("should succeed when no hook exists", async () => {
			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.false()
		})
	})

	describe("Fixture-Based Tests", () => {
		it("should handle cancel: true with no error message", async () => {
			await loadFixture("hooks/taskcancel/false-no-error", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.true()
			result.errorMessage!.should.equal("")
			// In abortTask(), no error is surfaced since errorMessage is empty
			// Cancellation still proceeds (fire-and-forget)
		})

		it("should handle cancel: true with error message", async () => {
			await loadFixture("hooks/taskcancel/false-with-error", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.true()
			result.errorMessage!.should.equal("some error happened")
			// In abortTask(), the errorMessage WILL be surfaced to user via this.say("error", ...)
			// Cancellation still proceeds (fire-and-forget)
		})

		it("should handle cancel: false with no error message", async () => {
			await loadFixture("hooks/taskcancel/true-no-error", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.false()
			result.errorMessage!.should.equal("")
			// Normal success case - no errors to surface
		})

		it("should handle cancel: false with error message", async () => {
			await loadFixture("hooks/taskcancel/true-with-error", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.false()
			result.errorMessage!.should.equal("some error happened")
			// In abortTask(), the errorMessage WILL be surfaced to user via this.say("error", ...)
			// This is the scenario that was fixed - error messages are now displayed regardless of shouldContinue value
			// Cancellation still proceeds (fire-and-forget)
		})

		it("should handle hook that exits with non-zero status code", async () => {
			await loadFixture("hooks/taskcancel/error", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			try {
				await runner.run({
					taskId: "test-task-id",
					taskCancel: {
						taskMetadata: {
							taskId: "test-task-id",
							ulid: "test-ulid",
							completionStatus: "cancelled",
						},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/TaskCancel.*exited with code 1/)
				// In abortTask(), this error WILL be caught and surfaced to user via this.say("error", ...)
				// Cancellation still proceeds (fire-and-forget)
			}
		})
	})
})
