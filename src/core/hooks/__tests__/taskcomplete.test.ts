import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { StateManager } from "../../storage/StateManager"
import { HookFactory } from "../hook-factory"
import { loadFixture } from "./test-utils"

describe("TaskComplete Hook", () => {
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
		it("should receive task metadata with result and command", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const metadata = input.taskComplete.taskMetadata;
const hasAllFields = metadata.taskId && metadata.ulid && metadata.result;
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasAllFields ? "All metadata present" : "Missing metadata",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Task completed successfully",
						command: "npm start",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("All metadata present")
		})

		it("should handle completion without command", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const metadata = input.taskComplete.taskMetadata;
const command = metadata.command || "";
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Command: '" + command + "'",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Task completed",
						command: "",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Command: ''")
		})

		it("should receive all common hook input fields", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasAllFields = input.clineVersion && input.hookName === 'TaskComplete' && 
                     input.timestamp && input.taskId && 
                     input.workspaceRoots !== undefined;
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasAllFields ? "All fields present" : "Missing fields",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Test task",
						command: "",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("All fields present")
		})

		it("should receive result text for logging", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const result = input.taskComplete.taskMetadata.result;
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Result length: " + result.length,
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "I've successfully completed the task by implementing all required features.",
						command: "",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Result length: 75")
		})
	})

	describe("Hook Behavior", () => {
		it("should execute successfully and capture context modification", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "TaskComplete hook executed successfully",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Test task",
						command: "",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("TaskComplete hook executed successfully")
		})

		it("should capture contextModification for logging even though task is complete", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "TASK_COMPLETE: Task '" + input.taskComplete.taskMetadata.taskId + "' finished",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Build a todo app",
						command: "",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("TASK_COMPLETE: Task 'test-task-id' finished")
		})

		it("should not block task completion when hook returns cancel: true", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  contextModification: "",
  errorMessage: "Hook tried to block completion"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Test task",
						command: "",
					},
				},
			})

			// Hook can return cancel: true, but it's ignored (task is already complete)
			// This is similar to TaskCancel behavior
			result.cancel.should.be.true()
			result.errorMessage!.should.equal("Hook tried to block completion")
		})
	})

	describe("Error Handling", () => {
		it("should handle hook script errors", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const hookScript = `#!/usr/bin/env node
console.error("Hook execution error");
process.exit(1);`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			try {
				await runner.run({
					taskId: "test-task-id",
					taskComplete: {
						taskMetadata: {
							taskId: "test-task-id",
							ulid: "test-ulid",
							result: "Test task",
							command: "",
						},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/TaskComplete.*exited with code 1/)
			}
		})

		it("should handle malformed JSON output from hook", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const hookScript = `#!/usr/bin/env node
console.log("not valid json")`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			// When hook exits 0 but has malformed JSON, it returns success without context
			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Test task",
						command: "",
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

		it("should execute both global and workspace TaskComplete hooks", async () => {
			// Create global hook
			const globalHookPath = path.join(globalHooksDir, "TaskComplete")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "GLOBAL: Task complete",
  errorMessage: ""
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			// Create workspace hook
			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "WORKSPACE: Task complete",
  errorMessage: ""
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")
			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Test task",
						command: "",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.match(/GLOBAL: Task complete/)
			result.contextModification!.should.match(/WORKSPACE: Task complete/)
		})

		it("should handle when global hook has error but workspace succeeds", async () => {
			const globalHookPath = path.join(globalHooksDir, "TaskComplete")
			const globalHookScript = `#!/usr/bin/env node
console.error("Global hook error");
process.exit(1);`
			await writeHookScript(globalHookPath, globalHookScript)

			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "TaskComplete")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Workspace succeeded",
  errorMessage: ""
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			// Both hooks run in parallel, if one fails the whole thing fails
			try {
				await runner.run({
					taskId: "test-task-id",
					taskComplete: {
						taskMetadata: {
							taskId: "test-task-id",
							ulid: "test-ulid",
							result: "Test task",
							command: "",
						},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/TaskComplete.*exited with code 1/)
			}
		})
	})

	describe("No Hook Behavior", () => {
		it("should succeed when no hook exists", async () => {
			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Test task",
						command: "",
					},
				},
			})

			result.cancel.should.be.false()
		})
	})

	describe("Fixture-Based Tests", () => {
		it("should work with success fixture", async () => {
			await loadFixture("hooks/taskcomplete/success", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Test task",
						command: "",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("TaskComplete hook executed successfully")
		})

		it("should work with error fixture", async () => {
			await loadFixture("hooks/taskcomplete/error", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			try {
				await runner.run({
					taskId: "test-task-id",
					taskComplete: {
						taskMetadata: {
							taskId: "test-task-id",
							ulid: "test-ulid",
							result: "Test task",
							command: "",
						},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/TaskComplete.*exited with code 1/)
			}
		})

		it("should work with context-injection fixture", async () => {
			await loadFixture("hooks/taskcomplete/context-injection", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskComplete")

			const result = await runner.run({
				taskId: "test-task-id",
				taskComplete: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						result: "Build a todo app",
						command: "",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("COMPLETED: Build a todo app")
		})
	})
})
