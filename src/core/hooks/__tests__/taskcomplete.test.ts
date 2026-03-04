import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import path from "path"
import sinon from "sinon"
import { HookFactory } from "../hook-factory"
import { createHookTestEnv, HookTestEnv, loadFixture, stubHookDirs, writeHookScriptForPlatform } from "./test-utils"

describe("TaskComplete Hook", () => {
	let tempDir: string
	let sandbox: sinon.SinonSandbox
	let getEnv: () => { tempDir: string }
	let hookTestEnv: HookTestEnv

	const writeHookScript = async (hookPath: string, nodeScript: string): Promise<void> => {
		await writeHookScriptForPlatform(hookPath, nodeScript)
	}

	beforeEach(async () => {
		hookTestEnv = await createHookTestEnv()
		tempDir = hookTestEnv.tempDir
		sandbox = hookTestEnv.sandbox

		getEnv = () => ({ tempDir })
	})

	afterEach(async () => {
		await hookTestEnv.cleanup()
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
			result.contextModification?.should.equal("All metadata present")
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
			result.contextModification?.should.equal("Command: ''")
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
			result.contextModification?.should.equal("All fields present")
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
			result.contextModification?.should.equal("Result length: 75")
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
			result.contextModification?.should.equal("TaskComplete hook executed successfully")
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
			result.contextModification?.should.equal("TASK_COMPLETE: Task 'test-task-id' finished")
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
			result.errorMessage?.should.equal("Hook tried to block completion")
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
		let workspaceHooksDir: string

		beforeEach(async () => {
			// Create global hooks directory
			globalHooksDir = path.join(tempDir, "global-hooks")
			await fs.mkdir(globalHooksDir, { recursive: true })
			workspaceHooksDir = path.join(tempDir, ".clinerules", "hooks")

			// Use deterministic hook directories to avoid test flakiness.
			stubHookDirs(sandbox, [globalHooksDir, workspaceHooksDir])
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
			result.contextModification?.should.match(/GLOBAL: Task complete/)
			result.contextModification?.should.match(/WORKSPACE: Task complete/)
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
			result.contextModification?.should.equal("TaskComplete hook executed successfully")
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
			result.contextModification?.should.equal("COMPLETED: Build a todo app")
		})
	})
})
