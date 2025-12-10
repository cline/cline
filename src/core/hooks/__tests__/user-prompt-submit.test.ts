import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { StateManager } from "../../storage/StateManager"
import { HookFactory } from "../hook-factory"

describe("UserPromptSubmit Hook", () => {
	// These tests assume uniform executable script execution via embedded shell
	// Windows support pending embedded shell implementation
	before(function () {
		if (process.platform === "win32") {
			this.skip()
		}
	})

	let tempDir: string
	let sandbox: sinon.SinonSandbox

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
			result.contextModification!.should.equal("Received prompt")
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

			result.contextModification!.should.equal("Line count: 3")
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

			result.contextModification!.should.equal("Prompt size: 10000")
		})

		it("should receive all common hook input fields", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "UserPromptSubmit")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasAllFields = input.clineVersion && input.hookName && input.timestamp && 
                     input.taskId && input.workspaceRoots !== undefined;
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

			result.contextModification!.should.equal("All fields present")
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

			result.contextModification!.should.equal("Prompt length: 0")
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

			result.contextModification!.should.equal("Special chars preserved")
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
			} catch (error: any) {
				error.message.should.match(/exited with code 1/)
			}
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
				// Get workspace dirs from original function
				const workspaceDirs = await originalGetAllHooksDirs()
				// Return global first, then workspace
				return [globalHooksDir, ...workspaceDirs]
			})
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
			result.contextModification!.should.match(/GLOBAL: Prompt received/)
			result.contextModification!.should.match(/WORKSPACE: Prompt received/)
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
			result.errorMessage!.should.match(/Workspace blocks/)
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

		// Helper to load a fixture and create a runner
		const loadFixtureAndCreateRunner = async (fixtureName: string) => {
			const { loadFixture } = await import("./test-utils")
			await loadFixture(`hooks/userpromptsubmit/${fixtureName}`, tempDir)

			const factory = new HookFactory()
			return await factory.create("UserPromptSubmit")
		}

		it("should work with success fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("success")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Create a feature",
					attachments: [],
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Prompt approved")
		})

		it("should work with blocking fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("blocking")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Do something forbidden",
					attachments: [],
				},
			})

			result.cancel.should.be.true()
			result.errorMessage!.should.equal("Prompt violates policy")
		})

		it("should work with context-injection fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("context-injection")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Build something",
					attachments: [],
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("CONTEXT_INJECTION: User is in plan mode")
		})

		it("should work with error fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("error")

			try {
				await runner.run({
					taskId: "test-task",
					userPromptSubmit: {
						prompt: "Test",
						attachments: [],
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/exited with code 1/)
			}
		})

		it("should work with malformed-json fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("malformed-json")

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

		it("should work with multiline fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("multiline")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Line 1\nLine 2\nLine 3",
					attachments: [],
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Line count: 3")
		})

		it("should work with large-prompt fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("large-prompt")

			const largePrompt = "x".repeat(10000)
			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: largePrompt,
					attachments: [],
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Prompt size: 10000")
		})

		it("should work with special-chars fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("special-chars")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "Test @user #feature $cost",
					attachments: [],
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Special chars preserved")
		})

		it("should work with empty-prompt fixture", async () => {
			const runner = await loadFixtureAndCreateRunner("empty-prompt")

			const result = await runner.run({
				taskId: "test-task",
				userPromptSubmit: {
					prompt: "",
					attachments: [],
				},
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Prompt length: 0")
		})
	})
})
