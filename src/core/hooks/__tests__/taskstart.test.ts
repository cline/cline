import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { StateManager } from "../../storage/StateManager"
import { HookFactory } from "../hook-factory"
import { loadFixture } from "./test-utils"

describe("TaskStart Hook", () => {
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
		it("should receive task metadata from startTask", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const metadata = input.taskStart.taskMetadata;
const hasAllFields = metadata.taskId && metadata.ulid && 'initialTask' in metadata;
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasAllFields ? "All metadata present" : "Missing metadata",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Build a todo app",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("All metadata present")
		})

		it("should receive all common hook input fields", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasAllFields = input.clineVersion && input.hookName === 'TaskStart' && 
                     input.timestamp && input.taskId && 
                     input.workspaceRoots !== undefined;
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasAllFields ? "All fields present" : "Missing fields",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Test task",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("All fields present")
		})

		it("should handle empty initialTask", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const initialTask = input.taskStart.taskMetadata.initialTask;
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Task length: " + initialTask.length,
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Task length: 0")
		})
	})

	describe("Hook Behavior", () => {
		it("should allow task to start when hook returns cancel: false", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "TaskStart hook executed successfully",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Test task",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("TaskStart hook executed successfully")
		})

		it("should block task when hook returns cancel: true", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  contextModification: "",
  errorMessage: "Task execution blocked by hook"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Test task",
					},
				},
			})

			result.cancel.should.be.true()
			result.errorMessage!.should.equal("Task execution blocked by hook")
		})

		it("should provide context modification even when not added to conversation", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "TASK_START: Task '" + input.taskStart.taskMetadata.initialTask + "' beginning",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Build a todo app",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("TASK_START: Task 'Build a todo app' beginning")
		})
	})

	describe("Error Handling", () => {
		it("should handle hook script errors", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const hookScript = `#!/usr/bin/env node
console.error("Hook execution error");
process.exit(1);`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			try {
				await runner.run({
					taskId: "test-task-id",
					taskStart: {
						taskMetadata: {
							taskId: "test-task-id",
							ulid: "test-ulid",
							initialTask: "Test task",
						},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/TaskStart.*exited with code 1/)
			}
		})

		it("should handle malformed JSON output from hook", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const hookScript = `#!/usr/bin/env node
console.log("not valid json")`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			// When hook exits 0 but has malformed JSON, it returns success without context
			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Test task",
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

		it("should execute both global and workspace TaskStart hooks", async () => {
			// Create global hook
			const globalHookPath = path.join(globalHooksDir, "TaskStart")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "GLOBAL: Task starting",
  errorMessage: ""
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			// Create workspace hook
			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "WORKSPACE: Task starting",
  errorMessage: ""
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")
			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Test task",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.match(/GLOBAL: Task starting/)
			result.contextModification!.should.match(/WORKSPACE: Task starting/)
		})

		it("should block if global hook blocks", async () => {
			const globalHookPath = path.join(globalHooksDir, "TaskStart")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  contextModification: "",
  errorMessage: "Global policy blocks this task"
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Workspace allows",
  errorMessage: ""
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")
			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Test task",
					},
				},
			})

			result.cancel.should.be.true()
			result.errorMessage!.should.match(/Global policy blocks this task/)
		})

		it("should block if workspace hook blocks even when global allows", async () => {
			const globalHookPath = path.join(globalHooksDir, "TaskStart")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Global allows",
  errorMessage: ""
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "TaskStart")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  contextModification: "",
  errorMessage: "Workspace blocks"
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")
			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Test task",
					},
				},
			})

			result.cancel.should.be.true()
			result.errorMessage!.should.match(/Workspace blocks/)
		})
	})

	describe("No Hook Behavior", () => {
		it("should allow task when no hook exists", async () => {
			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Test task",
					},
				},
			})

			result.cancel.should.be.false()
		})
	})

	describe("Fixture-Based Tests", () => {
		it("should work with success fixture", async () => {
			await loadFixture("hooks/taskstart/success", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Test task",
					},
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("TaskStart hook executed successfully")
		})

		it("should work with blocking fixture", async () => {
			await loadFixture("hooks/taskstart/blocking", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			const result = await runner.run({
				taskId: "test-task-id",
				taskStart: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						initialTask: "Test task",
					},
				},
			})

			result.cancel.should.be.true()
			result.errorMessage!.should.equal("Task execution blocked by hook")
		})

		it("should work with error fixture", async () => {
			await loadFixture("hooks/taskstart/error", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskStart")

			try {
				await runner.run({
					taskId: "test-task-id",
					taskStart: {
						taskMetadata: {
							taskId: "test-task-id",
							ulid: "test-ulid",
							initialTask: "Test task",
						},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/TaskStart.*exited with code 1/)
			}
		})
	})
})
