import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import path from "path"
import sinon from "sinon"
import { HookOutput } from "../../../shared/proto/cline/hooks"
import { HookFactory } from "../hook-factory"
import { createHookTestEnv, HookTestEnv, stubHookDirs, withFixtureRunner, writeHookScriptForPlatform } from "./test-utils"

describe("PostAssistantTurn Hook", () => {
	let tempDir: string
	let sandbox: sinon.SinonSandbox
	let hookTestEnv: HookTestEnv
	const WINDOWS_HOOK_TEST_TIMEOUT_MS = 15000

	type FixtureScenario = {
		fixtureName: string
		assistantText: string
		toolNames: string[]
		turnNumber: number
		assert: (result: HookOutput) => void
	}

	const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

	const writeHookScript = async (hookPath: string, nodeScript: string): Promise<void> => {
		await writeHookScriptForPlatform(hookPath, nodeScript)
	}

	const defaultInput = () => ({
		taskId: "test-task",
		postAssistantTurn: {
			assistantText: "Here is the result.",
			toolNames: [],
			turnNumber: 1,
			taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
		},
	})

	beforeEach(async () => {
		hookTestEnv = await createHookTestEnv()
		tempDir = hookTestEnv.tempDir
		sandbox = hookTestEnv.sandbox
	})

	afterEach(async () => {
		await hookTestEnv.cleanup()
	})

	describe("Hook Input Format", () => {
		it("should receive assistantText from the turn", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostAssistantTurn")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasText = input.postAssistantTurn && typeof input.postAssistantTurn.assistantText === 'string';
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasText ? "Received text" : "Missing text"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			const result = await runner.run(defaultInput())

			result.cancel.should.be.false()
			result.contextModification?.should.equal("Received text")
		})

		it("should receive toolNames array", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostAssistantTurn")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const tools = input.postAssistantTurn.toolNames;
console.log(JSON.stringify({
  cancel: false,
  contextModification: "tools=" + tools.join(",")
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			const result = await runner.run({
				taskId: "test-task",
				postAssistantTurn: {
					assistantText: "Done.",
					toolNames: ["read_file", "write_to_file"],
					turnNumber: 2,
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
				},
			})

			result.contextModification?.should.equal("tools=read_file,write_to_file")
		})

		it("should receive turnNumber", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostAssistantTurn")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "turn=" + input.postAssistantTurn.turnNumber
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			const result = await runner.run({
				taskId: "test-task",
				postAssistantTurn: {
					assistantText: "Done.",
					toolNames: [],
					turnNumber: 5,
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
				},
			})

			result.contextModification?.should.equal("turn=5")
		})

		it("should receive taskMetadata with taskId and ulid", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostAssistantTurn")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const meta = input.postAssistantTurn.taskMetadata;
const hasIds = meta.taskId && meta.ulid;
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasIds ? "IDs present" : "IDs missing"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			const result = await runner.run(defaultInput())

			result.contextModification?.should.equal("IDs present")
		})

		it("should receive all common hook input fields", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostAssistantTurn")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasAllFields = input.clineVersion && input.hookName === 'PostAssistantTurn' &&
                     input.timestamp && input.taskId && input.workspaceRoots !== undefined &&
                     input.model && input.model.provider && input.model.slug;
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasAllFields ? "All fields present" : "Missing fields"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			const result = await runner.run(defaultInput())

			result.contextModification?.should.equal("All fields present")
		})
	})

	describe("Observation-Only Semantics", () => {
		it("should return hook output even when cancel is true (caller ignores it)", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostAssistantTurn")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  errorMessage: "Hook tried to cancel"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			// The runner still returns the hook output — it's the caller's responsibility to ignore cancel
			const result = await runner.run(defaultInput())
			result.cancel.should.be.true()
			result.errorMessage?.should.equal("Hook tried to cancel")
		})

		it("should handle turn with no tool calls", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostAssistantTurn")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const toolNames = input.postAssistantTurn.toolNames || [];
const toolCount = toolNames.length;
console.log(JSON.stringify({
  cancel: false,
  contextModification: "tool_count=" + toolCount
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			const result = await runner.run({
				taskId: "test-task",
				postAssistantTurn: {
					assistantText: "No tools were needed.",
					toolNames: [],
					turnNumber: 1,
					taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
				},
			})

			result.contextModification?.should.equal("tool_count=0")
		})
	})

	describe("Error Handling", () => {
		it("should handle malformed JSON output from hook", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostAssistantTurn")
			const hookScript = `#!/usr/bin/env node
console.log("not valid json")`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			const result = await runner.run(defaultInput())

			result.cancel.should.be.false()
			;(result.contextModification === undefined || result.contextModification === "").should.be.true()
		})

		it("should handle hook script errors", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostAssistantTurn")
			const hookScript = `#!/usr/bin/env node
process.exit(1)`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			try {
				await runner.run(defaultInput())
				throw new Error("Should have thrown")
			} catch (error: unknown) {
				getErrorMessage(error).should.match(/exited with code 1/)
			}
		})
	})

	describe("Global and Workspace Hooks", () => {
		let globalHooksDir: string
		let workspaceHooksDir: string

		beforeEach(async () => {
			globalHooksDir = path.join(tempDir, "global-hooks")
			await fs.mkdir(globalHooksDir, { recursive: true })
			workspaceHooksDir = path.join(tempDir, ".clinerules", "hooks")

			stubHookDirs(sandbox, [globalHooksDir, workspaceHooksDir])
		})

		it("should execute both global and workspace PostAssistantTurn hooks", async () => {
			const globalHookPath = path.join(globalHooksDir, "PostAssistantTurn")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "GLOBAL: turn observed"
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "PostAssistantTurn")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "WORKSPACE: turn observed"
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			const result = await runner.run(defaultInput())

			result.cancel.should.be.false()
			result.contextModification?.should.match(/GLOBAL: turn observed/)
			result.contextModification?.should.match(/WORKSPACE: turn observed/)
		})
	})

	describe("No Hook Behavior", () => {
		it("should succeed when no hook exists", async () => {
			const factory = new HookFactory()
			const runner = await factory.create("PostAssistantTurn")

			const result = await runner.run(defaultInput())

			result.cancel.should.be.false()
		})
	})

	describe("Fixture-Based Tests", () => {
		it("should validate representative fixtures end-to-end", async function () {
			this.timeout(WINDOWS_HOOK_TEST_TIMEOUT_MS)

			const scenarios: FixtureScenario[] = [
				{
					fixtureName: "success",
					assistantText: "Here is the result.",
					toolNames: [],
					turnNumber: 1,
					assert: (result: HookOutput) => {
						result.cancel.should.be.false()
						result.contextModification?.should.equal("PostAssistantTurn hook executed successfully")
					},
				},
				{
					fixtureName: "logging",
					assistantText: "Done.",
					toolNames: ["read_file"],
					turnNumber: 3,
					assert: (result: HookOutput) => {
						result.cancel.should.be.false()
						result.contextModification?.should.equal("turn=3 tools=1 len=5")
					},
				},
			]

			for (const scenario of scenarios) {
				await withFixtureRunner(
					"PostAssistantTurn",
					`hooks/postassistantturn/${scenario.fixtureName}`,
					hookTestEnv,
					async (runner) => {
						const result = await runner.run({
							taskId: "test-task",
							postAssistantTurn: {
								assistantText: scenario.assistantText,
								toolNames: scenario.toolNames,
								turnNumber: scenario.turnNumber,
								taskMetadata: { taskId: "test-task", ulid: "test-ulid" },
							},
						})

						scenario.assert(result)
					},
				)
			}
		})

		it("should cover failing fixture path", async () => {
			await withFixtureRunner("PostAssistantTurn", "hooks/postassistantturn/error", hookTestEnv, async (runner) => {
				try {
					await runner.run(defaultInput())
					throw new Error("Should have thrown")
				} catch (error: unknown) {
					getErrorMessage(error).should.match(/PostAssistantTurn.*exited with code 1/)
				}
			})
		})
	})
})
