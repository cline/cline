import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import path from "path"
import sinon from "sinon"
import { HookOutput } from "../../../shared/proto/cline/hooks"
import { HookFactory } from "../hook-factory"
import { createHookTestEnv, HookTestEnv, stubHookDirs, withFixtureRunner, writeHookScriptForPlatform } from "./test-utils"

describe("UserPromptSubmit Hook", () => {
	let tempDir: string
	let sandbox: sinon.SinonSandbox
	let hookTestEnv: HookTestEnv
	const WINDOWS_HOOK_TEST_TIMEOUT_MS = 15000

	type FixtureScenario = {
		fixtureName: string
		prompt: string
		assert: (result: HookOutput) => void
	}

	const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

	const writeHookScript = async (hookPath: string, nodeScript: string): Promise<void> => {
		await writeHookScriptForPlatform(hookPath, nodeScript)
	}

	beforeEach(async () => {
		hookTestEnv = await createHookTestEnv()
		tempDir = hookTestEnv.tempDir
		sandbox = hookTestEnv.sandbox
	})

	afterEach(async () => {
		await hookTestEnv.cleanup()
	})

	describe("Hook Input Format", () => {
		it("should receive prompt text from user content", async function () {
			this.timeout(5000)

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasPrompt = input.userPromptSubmit && typeof input.userPromptSubmit.prompt === 'string' && input.userPromptSubmit.prompt.length > 0;
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasPrompt ? "Received prompt" : "Missing prompt"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Create a todo app",
					attachments: [],
				},
			})

			result.cancel.should.be.false()
			result.contextModification?.should.equal("Received prompt")
		})

		it("should handle multiline prompts", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const lineCount = (input.userPromptSubmit.prompt.match(/\\n/g) || []).length + 1;
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Line count: " + lineCount
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			const multilinePrompt = "Line 1\nLine 2\nLine 3"
			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: multilinePrompt,
					attachments: [],
				},
			})

			result.contextModification?.should.equal("Line count: 3")
		})

		it("should handle large prompts", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const size = input.userPromptSubmit.prompt.length;
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Prompt size: " + size
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			const largePrompt = "x".repeat(10000)
			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: largePrompt,
					attachments: [],
				},
			})

			result.contextModification?.should.equal("Prompt size: 10000")
		})

		it("should receive all common hook input fields", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasAllFields = input.clineVersion && input.hookName && input.timestamp && 
                     input.taskId && input.workspaceRoots !== undefined &&
                     input.model && input.model.provider && input.model.slug;
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasAllFields ? "All fields present" : "Missing fields"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Test",
					attachments: [],
				},
			})

			result.contextModification?.should.equal("All fields present")
		})
	})

	describe("Prompt Content Serialization", () => {
		it("should handle empty prompt", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const promptData = input.userPromptSubmit;
if (!promptData) {
  console.log(JSON.stringify({
    cancel: true,
    errorMessage: "No userPromptSubmit data"
  }));
  process.exit(0);
}
const promptLength = typeof promptData.prompt === 'string' ? promptData.prompt.length : (promptData.prompt ? String(promptData.prompt).length : 0);
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Prompt length: " + promptLength
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "",
					attachments: [],
				},
			})

			result.contextModification?.should.equal("Prompt length: 0")
		})

		it("should preserve special characters in prompt", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const prompt = input.userPromptSubmit.prompt;
const hasSpecialChars = prompt.includes("@") && prompt.includes("#") && prompt.includes("$");
console.log(JSON.stringify({
  cancel: false,
  contextModification: hasSpecialChars ? "Special chars preserved" : "Missing special chars"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Test @user #feature $cost",
					attachments: [],
				},
			})

			result.contextModification?.should.equal("Special chars preserved")
		})
	})

	describe("Error Handling", () => {
		it("should handle malformed JSON output from hook", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const hookScript = `#!/usr/bin/env node
console.log("not valid json")`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			// When hook exits 0 but has malformed JSON, it returns success without context
			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Test",
					attachments: [],
				},
			})

			// Hook succeeded (exit 0) but couldn't parse JSON, so returns success without context
			result.cancel.should.be.false()
			;(result.contextModification === undefined || result.contextModification === "").should.be.true()
		})

		it("should handle hook script errors", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const hookScript = `#!/usr/bin/env node
process.exit(1)`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			try {
				await runner.run({
					taskId: "test-task",
					userPromptSubmit: {
						prompt: "Test",
						attachments: [],
					},
				})
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
			// Create global hooks directory
			globalHooksDir = path.join(tempDir, "global-hooks")
			await fs.mkdir(globalHooksDir, { recursive: true })
			workspaceHooksDir = path.join(tempDir, ".clinerules", "hooks")

			// Use deterministic hook directories to avoid test flakiness from
			// calling real directory discovery logic in CI.
			stubHookDirs(sandbox, [globalHooksDir, workspaceHooksDir])
		})

		it("should execute both global and workspace UserPromptSubmit hooks", async () => {
			// Create global hook
			const globalHookPath = path.join(globalHooksDir, "UserPromptSubmit")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "GLOBAL: Prompt received"
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			// Create workspace hook
			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "WORKSPACE: Prompt received"
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Create a feature",
					attachments: [],
				},
			})

			result.cancel.should.be.false()
			result.contextModification?.should.match(/GLOBAL: Prompt received/)
			result.contextModification?.should.match(/WORKSPACE: Prompt received/)
		})

		it("should block if workspace hook blocks even when global allows", async () => {
			// Create allowing global hook
			const globalHookPath = path.join(globalHooksDir, "UserPromptSubmit")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Global allows"
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			// Create blocking workspace hook
			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  errorMessage: "Workspace blocks"
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Create a feature",
					attachments: [],
				},
			})

			result.cancel.should.be.true()
			result.errorMessage?.should.match(/Workspace blocks/)
		})
	})

	describe("No Hook Behavior", () => {
		it("should allow prompt when no hook exists", async () => {
			// Don't create any hook
			const factory = new HookFactory()
			const runner = await factory.create("UserPromptSubmit")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Create a feature",
					attachments: [],
				},
			})

			// NoOpRunner always returns success
			result.cancel.should.be.false()
		})
	})

	describe("Fixture-Based Tests", () => {
		// These tests demonstrate using pre-written fixtures from the fixtures directory
		// Fixtures serve as both test data and examples for manual testing
		const isWindows = process.platform === "win32"

		it("should validate representative fixtures end-to-end", async function () {
			// Multiple fixture scenarios spawn child processes sequentially,
			// which can easily exceed the default 2 s Mocha timeout.
			this.timeout(WINDOWS_HOOK_TEST_TIMEOUT_MS)

			const scenarios: FixtureScenario[] = [
				{
					fixtureName: "success",
					prompt: "Create a feature",
					assert: (result: HookOutput) => {
						result.cancel.should.be.false()
						result.contextModification?.should.equal("Prompt approved")
					},
				},
				{
					fixtureName: "blocking",
					prompt: "Do something forbidden",
					assert: (result: HookOutput) => {
						result.cancel.should.be.true()
						result.errorMessage?.should.equal("Prompt violates policy")
					},
				},
				{
					fixtureName: "context-injection",
					prompt: "Build something",
					assert: (result: HookOutput) => {
						result.cancel.should.be.false()
						result.contextModification?.should.equal("CONTEXT_INJECTION: User is in plan mode")
					},
				},
				{
					fixtureName: "multiline",
					prompt: "Line 1\nLine 2\nLine 3",
					assert: (result: HookOutput) => {
						result.cancel.should.be.false()
						result.contextModification?.should.equal("Line count: 3")
					},
				},
				{
					fixtureName: "special-chars",
					prompt: "Test @user #feature $cost",
					assert: (result: HookOutput) => {
						result.cancel.should.be.false()
						result.contextModification?.should.equal("Special chars preserved")
					},
				},
				{
					fixtureName: "empty-prompt",
					prompt: "",
					assert: (result: HookOutput) => {
						result.cancel.should.be.false()
						result.contextModification?.should.equal("Prompt length: 0")
					},
				},
			]

			if (!isWindows) {
				scenarios.push({
					fixtureName: "large-prompt",
					prompt: "x".repeat(10000),
					assert: (result: HookOutput) => {
						result.cancel.should.be.false()
						result.contextModification?.should.equal("Prompt size: 10000")
					},
				})
			}

			for (const scenario of scenarios) {
				await withFixtureRunner(
					"UserPromptSubmit",
					`hooks/userpromptsubmit/${scenario.fixtureName}`,
					hookTestEnv,
					async (runner) => {
						const result = await runner.run({
							taskId: "test-task",
							userPromptSubmit: {
								prompt: scenario.prompt,
								attachments: [],
							},
						})

						scenario.assert(result)
					},
				)
			}
		})

		it("should cover malformed-json fixture path", async () => {
			await withFixtureRunner("UserPromptSubmit", "hooks/userpromptsubmit/malformed-json", hookTestEnv, async (runner) => {
				const malformedResult = await runner.run({
					taskId: "test-task",
					userPromptSubmit: {
						prompt: "Test",
						attachments: [],
					},
				})

				malformedResult.cancel.should.be.false()
				;(
					malformedResult.contextModification === undefined || malformedResult.contextModification === ""
				).should.be.true()
			})
		})

		it("should cover failing fixture path", async () => {
			await withFixtureRunner("UserPromptSubmit", "hooks/userpromptsubmit/error", hookTestEnv, async (runner) => {
				try {
					await runner.run({
						taskId: "test-task",
						userPromptSubmit: {
							prompt: "Test",
							attachments: [],
						},
					})
					throw new Error("Should have thrown")
				} catch (error: unknown) {
					getErrorMessage(error).should.match(/exited with code 1/)
				}
			})
		})
	})
})
