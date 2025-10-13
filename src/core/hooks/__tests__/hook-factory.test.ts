import { describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import path from "path"
import { HookFactory } from "../hook-factory"
import { setupHookTests } from "./setup"
import { assertHookOutput, buildPostToolUseInput, buildPreToolUseInput, createTestHook } from "./test-utils"

describe("Hook System", () => {
	const { getEnv } = setupHookTests()

	// Skip hook execution tests on Windows (hooks not yet supported on Windows)
	before(function () {
		if (process.platform === "win32") {
			this.skip()
		}
	})

	describe("NoOpRunner", () => {
		it("should return success without executing anything when no hooks found", async () => {
			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))

			result.shouldContinue.should.be.true()
			;(result.contextModification === undefined || result.contextModification === "").should.be.true()
		})
	})

	describe("StdioHookRunner", () => {
		it("should execute hook script and parse output", async () => {
			await createTestHook(getEnv().tempDir, "PreToolUse", {
				shouldContinue: true,
				contextModification: "TEST_CONTEXT: Added by hook",
				errorMessage: "",
			})

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))

			assertHookOutput(result, {
				shouldContinue: true,
				contextModification: "TEST_CONTEXT: Added by hook",
			})
		})

		it("should handle script that blocks execution", async () => {
			await createTestHook(getEnv().tempDir, "PreToolUse", {
				shouldContinue: false,
				contextModification: "",
				errorMessage: "Hook blocked execution",
			})

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))

			assertHookOutput(result, {
				shouldContinue: false,
				errorMessage: "Hook blocked execution",
			})
		})

		it("should truncate large context modifications", async () => {
			// Create context larger than 50KB
			const MAX_CONTEXT_SIZE = 50 * 1024 // 50KB
			const largeContext = "x".repeat(MAX_CONTEXT_SIZE + 10000)
			await createTestHook(getEnv().tempDir, "PreToolUse", {
				shouldContinue: true,
				contextModification: largeContext,
				errorMessage: "",
			})

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))

			result.contextModification!.length.should.be.lessThan(largeContext.length)
			result.contextModification!.should.match(/truncated due to size limit/)
		})

		it("should handle script errors", async () => {
			await createTestHook(
				getEnv().tempDir,
				"PreToolUse",
				{
					shouldContinue: true,
					contextModification: "",
					errorMessage: "",
				},
				{ exitCode: 1 },
			)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			try {
				await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/exited with code 1/)
			}
		})

		it("should handle malformed JSON output", async () => {
			await createTestHook(
				getEnv().tempDir,
				"PreToolUse",
				{
					shouldContinue: true,
					contextModification: "",
					errorMessage: "",
				},
				{ malformedJson: true },
			)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			try {
				await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/Failed to parse hook output/)
			}
		})

		it("should pass hook input via stdin", async () => {
			// Create a custom hook that echoes the tool name
			const hookPath = path.join(getEnv().tempDir, ".clinerules", "hooks")
			const scriptContent = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  shouldContinue: true,
  contextModification: "Received tool: " + input.preToolUse.toolName,
  errorMessage: ""
}))`

			// Create single shell script (works on all platforms via embedded shell)
			const scriptPath = path.join(hookPath, "PreToolUse")
			await fs.writeFile(scriptPath, scriptContent)
			try {
				await fs.chmod(scriptPath, 0o755)
			} catch (error) {
				// Ignore chmod errors on Windows
			}

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run(buildPreToolUseInput({ toolName: "my_test_tool" }))

			result.contextModification!.should.equal("Received tool: my_test_tool")
		})
	})

	describe("PostToolUse Hook", () => {
		it("should receive execution results", async () => {
			// Create a custom hook that echoes the success status
			const hookPath = path.join(getEnv().tempDir, ".clinerules", "hooks")
			const scriptContent = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  shouldContinue: true,
  contextModification: "Tool succeeded: " + input.postToolUse.success,
  errorMessage: ""
}))`

			// Create single shell script (works on all platforms via embedded shell)
			const scriptPath = path.join(hookPath, "PostToolUse")
			await fs.writeFile(scriptPath, scriptContent)
			try {
				await fs.chmod(scriptPath, 0o755)
			} catch (error) {
				// Ignore chmod errors on Windows
			}

			const factory = new HookFactory()
			const runner = await factory.create("PostToolUse")
			const result = await runner.run(
				buildPostToolUseInput({
					toolName: "test_tool",
					result: "success",
					success: true,
					executionTimeMs: 100,
				}),
			)

			result.contextModification!.should.equal("Tool succeeded: true")
		})
	})

	describe("Hook Discovery", () => {
		it("should find executable hook on Unix", async function () {
			if (process.platform === "win32") {
				this.skip()
				return
			}

			const hookPath = path.join(getEnv().tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({ shouldContinue: true, contextModification: "", errorMessage: "" }))`

			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o755)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))

			result.shouldContinue.should.be.true()
		})

		it("should not find non-executable file on Unix", async function () {
			if (process.platform === "win32") {
				this.skip()
				return
			}

			const hookPath = path.join(getEnv().tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({ shouldContinue: true, contextModification: "", errorMessage: "" }))`

			// Write but don't make executable
			await fs.writeFile(hookPath, hookScript)
			await fs.chmod(hookPath, 0o644) // Explicitly remove executable permission

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))

			// Should return NoOpRunner which always returns success
			result.shouldContinue.should.be.true()
		})

		it("should handle missing hooks gracefully", async () => {
			// No hook file created
			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))

			result.shouldContinue.should.be.true()
		})
	})

	describe("Error Handling", () => {
		it("should handle expected ENOENT errors silently", async () => {
			// No hook file exists - ENOENT is expected
			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))

			result.shouldContinue.should.be.true()
		})

		it("should handle hook input with all parameters", async () => {
			// Create a hook that validates all input fields are present
			const hookPath = path.join(getEnv().tempDir, ".clinerules", "hooks")
			const scriptContent = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasAllFields = input.clineVersion && input.hookName && input.timestamp && 
                     input.taskId && input.workspaceRoots !== undefined;
console.log(JSON.stringify({
  shouldContinue: true,
  contextModification: hasAllFields ? "All fields present" : "Missing fields",
  errorMessage: ""
}))`

			// Create single shell script (works on all platforms via embedded shell)
			const scriptPath = path.join(hookPath, "PreToolUse")
			await fs.writeFile(scriptPath, scriptContent)
			try {
				await fs.chmod(scriptPath, 0o755)
			} catch (error) {
				// Ignore chmod errors on Windows
			}

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run(
				buildPreToolUseInput({
					toolName: "test_tool",
					parameters: { key: "value" },
				}),
			)

			result.contextModification!.should.equal("All fields present")
		})
	})
})
