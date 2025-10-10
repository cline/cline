import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { StateManager } from "../../storage/StateManager"
import { HookFactory } from "../hook-factory"

describe("Hook System", () => {
	let tempDir: string
	let sandbox: sinon.SinonSandbox

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
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors
		}
	})

	describe("NoOpRunner", () => {
		it("should return success without executing anything when no hooks found", async () => {
			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			result.shouldContinue.should.be.true()
			;(result.contextModification === undefined || result.contextModification === "").should.be.true()
		})
	})

	describe("StdioHookRunner", () => {
		it("should execute hook script and parse output", async () => {
			// Create a test hook script
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = require('fs').readFileSync(0, 'utf-8');
console.log(JSON.stringify({
  shouldContinue: true,
  contextModification: "TEST_CONTEXT: Added by hook"
}))`

			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o755)

			// Test execution
			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			result.shouldContinue.should.be.true()
			result.contextModification!.should.equal("TEST_CONTEXT: Added by hook")
		})

		it("should handle script that blocks execution", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  shouldContinue: false,
  errorMessage: "Hook blocked execution"
}))`

			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o755)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			result.shouldContinue.should.be.false()
			result.errorMessage!.should.equal("Hook blocked execution")
		})

		it("should truncate large context modifications", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			// Create context larger than 50KB
			const largeContext = "x".repeat(60000)
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  shouldContinue: true,
  contextModification: "${largeContext}"
}))`

			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o755)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			result.contextModification!.length.should.be.lessThan(60000)
			result.contextModification!.should.match(/truncated due to size limit/)
		})

		it("should handle script errors", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
process.exit(1)`

			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o755)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			try {
				await runner.run({
					taskId: "test-task",
					preToolUse: {
						toolName: "test_tool",
						parameters: {},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/exited with code 1/)
			}
		})

		it("should handle malformed JSON output", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
console.log("not valid json")`

			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o755)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			try {
				await runner.run({
					taskId: "test-task",
					preToolUse: {
						toolName: "test_tool",
						parameters: {},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/Failed to parse hook output/)
			}
		})

		it("should pass hook input via stdin", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  shouldContinue: true,
  contextModification: "Received tool: " + input.preToolUse.toolName
}))`

			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o755)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "my_test_tool",
					parameters: {},
				},
			})

			result.contextModification!.should.equal("Received tool: my_test_tool")
		})
	})

	describe("PostToolUse Hook", () => {
		it("should receive execution results", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  shouldContinue: true,
  contextModification: "Tool succeeded: " + input.postToolUse.success
}))`

			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o755)

			const factory = new HookFactory()
			const runner = await factory.create("PostToolUse")

			const result = await runner.run({
				taskId: "test-task",
				postToolUse: {
					toolName: "test_tool",
					parameters: {},
					result: "success",
					success: true,
					executionTimeMs: 100,
				},
			})

			result.contextModification!.should.equal("Tool succeeded: true")
		})
	})

	describe("Hook Discovery", () => {
		it("should find executable hook on Unix", async function () {
			if (process.platform === "win32") {
				this.skip()
				return
			}

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({ shouldContinue: true }))`

			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o755)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Should find and execute the hook
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			result.shouldContinue.should.be.true()
		})

		it("should not find non-executable file on Unix", async function () {
			if (process.platform === "win32") {
				this.skip()
				return
			}

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({ shouldContinue: true }))`

			// Write but don't make executable
			await fs.writeFile(hookPath, hookScript)
			// Explicitly remove executable permission
			await fs.chmod(hookPath, 0o644)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Should return NoOpRunner
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			// NoOpRunner always returns success
			result.shouldContinue.should.be.true()
		})

		it("should handle missing hooks gracefully", async () => {
			// No hook file created
			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Should return NoOpRunner
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			result.shouldContinue.should.be.true()
		})
	})

	describe("Error Handling", () => {
		it("should handle expected ENOENT errors silently", async () => {
			// No hook file exists - ENOENT is expected
			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Should not throw, returns NoOpRunner
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			result.shouldContinue.should.be.true()
		})

		it("should handle hook input with all parameters", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasAllFields = input.clineVersion && input.hookName && input.timestamp && 
                     input.taskId && input.workspaceRoots !== undefined;
console.log(JSON.stringify({
  shouldContinue: true,
  contextModification: hasAllFields ? "All fields present" : "Missing fields"
}))`

			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o755)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: { key: "value" },
				},
			})

			result.contextModification!.should.equal("All fields present")
		})
	})
})
