import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { setDistinctId } from "@/services/logging/distinctId"
import { StateManager } from "../../storage/StateManager"
import { HookFactory } from "../hook-factory"

describe("Hook System", () => {
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
		setDistinctId("test-id")
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })

		// Create .clinerules/hooks directory
		const hooksDir = path.join(tempDir, ".clinerules", "hooks")
		await fs.mkdir(hooksDir, { recursive: true })

		// Mock StateManager to return our temp directory
		sandbox.stub(StateManager, "get").returns({
			getGlobalStateKey: (key: string) => {
				if (key === "workspaceRoots") {
					return [{ path: tempDir }]
				}
				if (key === "primaryRootIndex") {
					return 0
				}
				return undefined
			},
			getGlobalSettingsKey: (key: string) => {
				if (key === "mode") {
					return "act"
				}
				if (key === "actModeApiProvider") {
					return "anthropic"
				}
				if (key === "actModeApiModelId") {
					return "claude-sonnet-4-20250514"
				}
				if (key === "planModeApiProvider") {
					return "anthropic"
				}
				if (key === "planModeApiModelId") {
					return "claude-sonnet-4-20250514"
				}
				return undefined
			},
		} as any)

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
		} catch (_error) {
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

			result.cancel.should.be.false()
			;(result.contextModification === undefined || result.contextModification === "").should.be.true()
		})
	})

	describe("StdioHookRunner", () => {
		it("should execute workspace hook from its respective workspace root directory", async () => {
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
			const cwdFromHook = result.contextModification!.replace("CWD: ", "")
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
			result.contextModification!.should.equal("TEST_CONTEXT: Added by hook")
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
			result.errorMessage!.should.equal("Hook blocked execution")
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

			result.contextModification!.length.should.be.lessThan(60000)
			result.contextModification!.should.match(/truncated due to size limit/)
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

			result.contextModification!.should.equal("Received tool: my_test_tool")
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

			result.contextModification!.should.equal("Tool succeeded: true")
		})
	})

	describe("Hook Discovery", () => {
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

			result.contextModification!.should.equal("All fields present")
		})
	})

	describe("Model ID in Hook Input", () => {
		const restubStateManagerGet = (overrides: {
			mode?: "plan" | "act"
			actModeApiProvider?: string
			actModeApiModelId?: string
			actModeOpenRouterModelId?: string
			actModeOpenAiModelId?: string
			actModeOllamaModelId?: string
			planModeApiProvider?: string
			planModeApiModelId?: string
			planModeOpenRouterModelId?: string
			planModeOpenAiModelId?: string
		}): void => {
			// Replace only this stub; avoid sandbox.restore() which can unintentionally
			// remove unrelated stubs/mocks within the test.
			;(StateManager.get as sinon.SinonStub).restore()
			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: (key: string) => {
					if (key === "workspaceRoots") {
						return [{ path: tempDir }]
					}
					if (key === "primaryRootIndex") {
						return 0
					}
					return undefined
				},
				getGlobalSettingsKey: (key: string) => {
					if (key === "mode") return overrides.mode ?? "act"
					if (key === "actModeApiProvider") return overrides.actModeApiProvider ?? "anthropic"
					if (key === "actModeApiModelId") return overrides.actModeApiModelId ?? "claude-sonnet-4-20250514"
					if (key === "actModeOpenRouterModelId") return overrides.actModeOpenRouterModelId
					if (key === "actModeOpenAiModelId") return overrides.actModeOpenAiModelId
					if (key === "actModeOllamaModelId") return overrides.actModeOllamaModelId
					if (key === "planModeApiProvider") return overrides.planModeApiProvider ?? "anthropic"
					if (key === "planModeApiModelId") return overrides.planModeApiModelId ?? "claude-sonnet-4-20250514"
					if (key === "planModeOpenRouterModelId") return overrides.planModeOpenRouterModelId
					if (key === "planModeOpenAiModelId") return overrides.planModeOpenAiModelId
					return undefined
				},
			} as any)
		}

		it("should include modelId in hook input with format provider:modelId", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Model ID: " + input.modelId
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

			result.cancel.should.be.false()
			// Default mock returns anthropic:claude-sonnet-4-20250514
			result.contextModification!.should.equal("Model ID: anthropic:claude-sonnet-4-20250514")
		})

		it("should include modelId with cline provider format (cline:anthropic/claude-sonnet-4.5)", async () => {
			restubStateManagerGet({
				mode: "act",
				actModeApiProvider: "cline",
				actModeApiModelId: "claude-sonnet-4-20250514", // should not be used for cline modelId display
				actModeOpenRouterModelId: "anthropic/claude-sonnet-4.5",
				planModeApiProvider: "cline",
				planModeApiModelId: "claude-sonnet-4-20250514",
				planModeOpenRouterModelId: "anthropic/claude-sonnet-4.5",
			})

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Model ID: " + input.modelId
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

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Model ID: cline:anthropic/claude-sonnet-4.5")
		})

		it("should use plan mode provider/model when in plan mode", async () => {
			restubStateManagerGet({
				mode: "plan",
				actModeApiProvider: "anthropic",
				actModeApiModelId: "claude-sonnet-4-20250514",
				planModeApiProvider: "cline",
				planModeApiModelId: "claude-opus-4-5-20251101", // should not be used for cline modelId display
				planModeOpenRouterModelId: "openai/gpt-5.2",
			})

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Model ID: " + input.modelId
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

			result.cancel.should.be.false()
			// Should use plan mode provider/model since mode is "plan"
			result.contextModification!.should.equal("Model ID: cline:openai/gpt-5.2")
		})

		it("should fall back to empty model for cline if openRouterModelId is missing", async () => {
			restubStateManagerGet({
				mode: "act",
				actModeApiProvider: "cline",
				actModeApiModelId: "claude-opus-4-5-20251101",
				// intentionally missing actModeOpenRouterModelId
			})

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({ cancel: false, contextModification: "Model ID: " + input.modelId }))`

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

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Model ID: cline:")
		})

		it("should use openai-compat prefix when provider is openai", async () => {
			restubStateManagerGet({
				mode: "act",
				actModeApiProvider: "openai",
				actModeApiModelId: "claude-opus-4-5-20251101", // should not be used when OpenAI model id is present
				actModeOpenAiModelId: "gpt-4.1",
				planModeApiProvider: "openai",
				planModeApiModelId: "claude-opus-4-5-20251101",
				planModeOpenAiModelId: "gpt-4.1",
			})

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  cancel: false,
  contextModification: "Model ID: " + input.modelId
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

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Model ID: openai-compat:gpt-4.1")
		})

		it("should not use stale actModeApiModelId when switching to openai (uses actModeOpenAiModelId)", async () => {
			// This reproduces a real-world scenario:
			// 1) user previously used Anthropic provider (actModeApiModelId set to a claude model)
			// 2) user switches to OpenAI-compatible provider and selects a GPT model
			// The hook modelId should be openai-compat:<openAiModelId>, NOT openai-compat:<stale actModeApiModelId>
			restubStateManagerGet({
				mode: "act",
				actModeApiProvider: "openai",
				actModeApiModelId: "claude-opus-4-5-20251101", // stale value from prior provider
				actModeOpenAiModelId: "gpt-4.1",
			})

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({ cancel: false, contextModification: "Model ID: " + input.modelId }))`
			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: { toolName: "test_tool", parameters: {} },
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Model ID: openai-compat:gpt-4.1")
		})

		it("should use default model for openai-native when apiModelId is from different provider", async () => {
			// Simulates switching from Anthropic to openai-native:
			// - actModeApiModelId still has claude model (not valid for openai-native)
			// - Should fall back to openai-native default model
			restubStateManagerGet({
				mode: "act",
				actModeApiProvider: "openai-native",
				actModeApiModelId: "claude-opus-4-5-20251101", // stale value - not in openAiNativeModels
			})

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({ cancel: false, contextModification: "Model ID: " + input.modelId }))`
			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: { toolName: "test_tool", parameters: {} },
			})

			result.cancel.should.be.false()
			// Should use default openai-native model, not the stale claude model
			result.contextModification!.should.equal("Model ID: openai-native:gpt-5.2")
		})

		it("should use valid openai-native model when apiModelId is correct", async () => {
			restubStateManagerGet({
				mode: "act",
				actModeApiProvider: "openai-native",
				actModeApiModelId: "gpt-5.2", // valid openai-native model
			})

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({ cancel: false, contextModification: "Model ID: " + input.modelId }))`
			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: { toolName: "test_tool", parameters: {} },
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Model ID: openai-native:gpt-5.2")
		})

		it("should use openrouter-specific model ID field (not stale apiModelId)", async () => {
			// Simulates switching to openrouter provider
			// openrouter uses *ModeOpenRouterModelId, not *ModeApiModelId
			restubStateManagerGet({
				mode: "act",
				actModeApiProvider: "openrouter",
				actModeApiModelId: "gpt-5.2-codex", // stale value from prior provider
				actModeOpenRouterModelId: "openai/gpt-5.2", // correct openrouter model
			})

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({ cancel: false, contextModification: "Model ID: " + input.modelId }))`
			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: { toolName: "test_tool", parameters: {} },
			})

			result.cancel.should.be.false()
			// Should use openRouterModelId, not the stale apiModelId
			result.contextModification!.should.equal("Model ID: openrouter:openai/gpt-5.2")
		})

		it("should use provider-specific model fields for other providers", async () => {
			// Test ollama which uses *ModeOllamaModelId
			restubStateManagerGet({
				mode: "act",
				actModeApiProvider: "ollama",
				actModeApiModelId: "claude-opus-4-5-20251101", // stale
				actModeOllamaModelId: "llama3:latest", // correct ollama model
			})

			const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({ cancel: false, contextModification: "Model ID: " + input.modelId }))`
			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")
			const result = await runner.run({
				taskId: "test-task",
				preToolUse: { toolName: "test_tool", parameters: {} },
			})

			result.cancel.should.be.false()
			result.contextModification!.should.equal("Model ID: ollama:llama3:latest")
		})
	})

	describe("Global Hooks", () => {
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
			result.contextModification!.should.match(/GLOBAL: Context added/)
			result.contextModification!.should.match(/WORKSPACE: Context added/)
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
			result.errorMessage!.should.match(/Global policy violation/)
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
			result.contextModification!.should.equal("Global hook only")
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
			result.errorMessage!.should.match(/Workspace blocks/)
			// Context from global should still be included
			result.contextModification!.should.match(/Global allows/)
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
			result.errorMessage!.should.match(/Global error/)
			result.errorMessage!.should.match(/Workspace error/)
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
			const cwdFromHook = result.contextModification!.replace("CWD: ", "")
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

			result.contextModification!.should.equal("Global observed: true")
		})
	})
})
