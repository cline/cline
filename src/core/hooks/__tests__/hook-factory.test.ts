import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import path from "path"
import sinon from "sinon"
import { setDistinctId } from "@/services/logging/distinctId"
import { HookFactory } from "../hook-factory"
import { createHookTestEnv, HookTestEnv, stubHookDirs, withPlatform, writeHookScriptForPlatform } from "./test-utils"

describe("Hook System", () => {
	let tempDir: string
	let sandbox: sinon.SinonSandbox
	let hookTestEnv: HookTestEnv
	const WINDOWS_HOOK_TEST_TIMEOUT_MS = 15000

	// Helper to write executable hook script
	const writeHookScript = async (hookPath: string, nodeScript: string): Promise<void> => {
		await writeHookScriptForPlatform(hookPath, nodeScript)
	}

	beforeEach(async () => {
		setDistinctId("test-id")
		hookTestEnv = await createHookTestEnv()
		tempDir = hookTestEnv.tempDir
		sandbox = hookTestEnv.sandbox
	})

	afterEach(async () => {
		await hookTestEnv.cleanup()
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

			result.cancel.should.be.false()
			;(result.contextModification === undefined || result.contextModification === "").should.be.true()
		})
	})

	describe("StdioHookRunner", () => {
		it("should execute workspace hook from its respective workspace root directory", async function () {
			if (process.platform === "win32") {
				this.timeout(WINDOWS_HOOK_TEST_TIMEOUT_MS)
			}

			// Create a test hook script that outputs the current working directory
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = require('fs').readFileSync(0, 'utf-8');
// Output the current working directory
console.log(JSON.stringify({
  cancel: false,
  contextModification: "CWD: " + process.cwd()
}))`

			await writeHookScript(hookPath, hookScript)

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

			result.cancel.should.be.false()
			// The hook should execute from its workspace root (tempDir)
			// Use fs.realpath to normalize paths (handles macOS /private prefix)
			const cwdFromHook = result.contextModification?.replace("CWD: ", "")
			const normalizedCwd = await fs.realpath(cwdFromHook)
			const normalizedTempDir = await fs.realpath(tempDir)
			normalizedCwd.should.equal(normalizedTempDir)
		})

		it("should execute hook script and parse output", async () => {
			// Create a test hook script
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = require('fs').readFileSync(0, 'utf-8');
console.log(JSON.stringify({
  cancel: false,
  contextModification: "TEST_CONTEXT: Added by hook"
}))`

			await writeHookScript(hookPath, hookScript)

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

			result.cancel.should.be.false()
			result.contextModification?.should.equal("TEST_CONTEXT: Added by hook")
		})

		it("should handle script that blocks execution", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  errorMessage: "Hook blocked execution"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			result.cancel.should.be.true()
			result.errorMessage?.should.equal("Hook blocked execution")
		})

		it("should truncate large context modifications", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			// Create context larger than 50KB
			const largeContext = "x".repeat(60000)
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "${largeContext}"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			result.contextModification?.length.should.be.lessThan(60000)
			result.contextModification?.should.match(/truncated due to size limit/)
		})

		it("should handle script errors", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
process.exit(1)`

			await writeHookScript(hookPath, hookScript)

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

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// When hook exits 0 but has malformed JSON, it returns success without context
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: {},
				},
			})

			// Hook succeeded (exit 0) but couldn't parse JSON, so returns success without context
			result.cancel.should.be.false()
			;(result.contextModification === undefined || result.contextModification === "").should.be.true()
		})

		it("should pass hook input via stdin", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Received tool: " + input.preToolUse.toolName
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "my_test_tool",
					parameters: {},
				},
			})

			result.contextModification?.should.equal("Received tool: my_test_tool")
		})
	})

	describe("PostToolUse Hook", () => {
		it("should receive execution results", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PostToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Tool succeeded: " + input.postToolUse.success
}))`

			await writeHookScript(hookPath, hookScript)

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

			result.contextModification?.should.equal("Tool succeeded: true")
		})
	})

	describe("Hook Discovery", () => {
		it("should generate Windows PowerShell bridge files with real newlines", async () => {
			const hooksDir = path.join(tempDir, ".clinerules", "hooks")
			const hookBasePath = path.join(hooksDir, "PreToolUse")

			await withPlatform("win32", async () => {
				await writeHookScript(hookBasePath, "#!/usr/bin/env node\nprocess.exit(0)")
			})

			const ps1Content = await fs.readFile(`${hookBasePath}.ps1`, "utf-8")
			ps1Content.should.match(/\n\$scriptPath = Join-Path/)
			ps1Content.should.not.match(/`n\$scriptPath/)
		})

		it("should resolve .ps1 hook on windows", async () => {
			const hooksDir = path.join(tempDir, ".clinerules", "hooks")
			const ps1Path = path.join(hooksDir, "PreToolUse.ps1")
			await fs.writeFile(ps1Path, "Write-Output '{\"cancel\":false}'")

			const found = await withPlatform("win32", async () => {
				return await HookFactory.findHookInHooksDir("PreToolUse", hooksDir)
			})

			should.exist(found)
			if (!found) {
				throw new Error("Expected .ps1 hook to be resolved")
			}
			found.should.equal(ps1Path)
		})

		it("should ignore extensionless hook on windows and use .ps1 only", async () => {
			const hooksDir = path.join(tempDir, ".clinerules", "hooks")
			const extensionless = path.join(hooksDir, "PreToolUse")
			const ps1Path = path.join(hooksDir, "PreToolUse.ps1")
			await fs.writeFile(extensionless, "Write-Output '{\"cancel\":false}'")
			await fs.writeFile(ps1Path, "Write-Output '{\"cancel\":false}'")

			const found = await withPlatform("win32", async () => {
				return await HookFactory.findHookInHooksDir("PreToolUse", hooksDir)
			})

			should.exist(found)
			if (!found) {
				throw new Error("Expected .ps1 hook to be resolved")
			}
			found.should.equal(ps1Path)
		})

		it("should ignore .ps1 hook on unix-like platforms", async () => {
			const hooksDir = path.join(tempDir, ".clinerules", "hooks")
			const ps1Path = path.join(hooksDir, "PreToolUse.ps1")
			await fs.writeFile(ps1Path, "Write-Output '{\"cancel\":false}'")

			const found = await withPlatform("linux", async () => {
				return await HookFactory.findHookInHooksDir("PreToolUse", hooksDir)
			})

			should.not.exist(found)
		})

		it("should find executable hook", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({ cancel: false }))`

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

			result.cancel.should.be.false()
		})

		it("should not find non-executable file", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({ cancel: false }))`

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
			result.cancel.should.be.false()
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

			result.cancel.should.be.false()
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

			result.cancel.should.be.false()
		})

		it("should handle hook input with all parameters", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
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
			const runner = await factory.create("PreToolUse")

			const result = await runner.run({
				taskId: "test-task",
				preToolUse: {
					toolName: "test_tool",
					parameters: { key: "value" },
				},
			})

			result.contextModification?.should.equal("All fields present")
		})
	})

	describe("Global Hooks", () => {
		let globalHooksDir: string
		let workspaceHooksDir: string

		beforeEach(async () => {
			// Create global hooks directory
			globalHooksDir = path.join(tempDir, "global-hooks")
			await fs.mkdir(globalHooksDir, { recursive: true })
			workspaceHooksDir = path.join(tempDir, ".clinerules", "hooks")

			// Mock getAllHooksDirs with deterministic test directories only.
			// Avoid calling the real implementation, which may hit OS-specific
			// filesystem resolution and add timing variance in CI.
			stubHookDirs(sandbox, [globalHooksDir, workspaceHooksDir])
		})

		it("should execute both global and workspace hooks", async () => {
			// Create global hook
			const globalHookPath = path.join(globalHooksDir, "PreToolUse")
			const globalHookScript = `#!/usr/bin/env node
const input = require('fs').readFileSync(0, 'utf-8');
console.log(JSON.stringify({
  cancel: false,
  contextModification: "GLOBAL: Context added"
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			// Create workspace hook
			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const workspaceHookScript = `#!/usr/bin/env node
const input = require('fs').readFileSync(0, 'utf-8');
console.log(JSON.stringify({
  cancel: false,
  contextModification: "WORKSPACE: Context added"
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			// Execute
			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: { toolName: "test_tool", parameters: {} },
			})

			// Both contexts should be present (order not guaranteed)
			result.cancel.should.be.false()
			result.contextModification?.should.match(/GLOBAL: Context added/)
			result.contextModification?.should.match(/WORKSPACE: Context added/)
		})

		it("should block execution if global hook blocks", async () => {
			// Create blocking global hook
			const globalHookPath = path.join(globalHooksDir, "PreToolUse")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  errorMessage: "Global policy violation"
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			// Create allowing workspace hook
			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: { toolName: "test_tool", parameters: {} },
			})

			result.cancel.should.be.true()
			result.errorMessage?.should.match(/Global policy violation/)
		})

		it("should work with only global hooks (no workspace hooks)", async () => {
			// Create global hook only
			const globalHookPath = path.join(globalHooksDir, "PreToolUse")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Global hook only"
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: { toolName: "test_tool", parameters: {} },
			})

			result.cancel.should.be.false()
			result.contextModification?.should.equal("Global hook only")
		})

		it("should block if workspace hook blocks even when global allows", async () => {
			// Create allowing global hook
			const globalHookPath = path.join(globalHooksDir, "PreToolUse")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Global allows"
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			// Create blocking workspace hook
			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  errorMessage: "Workspace blocks"
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: { toolName: "test_tool", parameters: {} },
			})

			result.cancel.should.be.true()
			result.errorMessage?.should.match(/Workspace blocks/)
			// Context from global should still be included
			result.contextModification?.should.match(/Global allows/)
		})

		it("should combine error messages from global and workspace hooks", async () => {
			// Create blocking global hook
			const globalHookPath = path.join(globalHooksDir, "PreToolUse")
			const globalHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  errorMessage: "Global error"
}))`
			await writeHookScript(globalHookPath, globalHookScript)

			// Create blocking workspace hook
			const workspaceHookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const workspaceHookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  errorMessage: "Workspace error"
}))`
			await writeHookScript(workspaceHookPath, workspaceHookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: { toolName: "test_tool", parameters: {} },
			})

			result.cancel.should.be.true()
			result.errorMessage?.should.match(/Global error/)
			result.errorMessage?.should.match(/Workspace error/)
		})

		it("should execute global hook from primary workspace root directory", async () => {
			// Create a global hook script that outputs the current working directory
			const globalHookPath = path.join(globalHooksDir, "PreToolUse")
			const globalHookScript = `#!/usr/bin/env node
const input = require('fs').readFileSync(0, 'utf-8');
// Output the current working directory
console.log(JSON.stringify({
  cancel: false,
  contextModification: "CWD: " + process.cwd()
}))`
			await writeHookScript(globalHookPath, globalHookScript)

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

			result.cancel.should.be.false()
			// Global hooks should execute from the primary workspace root (tempDir)
			// Use fs.realpath to normalize paths (handles macOS /private prefix)
			const cwdFromHook = result.contextModification?.replace("CWD: ", "")
			const normalizedCwd = await fs.realpath(cwdFromHook)
			const normalizedTempDir = await fs.realpath(tempDir)
			normalizedCwd.should.equal(normalizedTempDir)
		})

		it("should work with global PostToolUse hooks", async () => {
			// Create global PostToolUse hook
			const globalHookPath = path.join(globalHooksDir, "PostToolUse")
			const globalHookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Global observed: " + input.postToolUse.success
}))`
			await writeHookScript(globalHookPath, globalHookScript)

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

			result.contextModification?.should.equal("Global observed: true")
		})
	})
})
