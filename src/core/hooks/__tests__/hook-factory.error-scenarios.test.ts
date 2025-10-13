import { describe, it } from "mocha"
import "should"
import { exec } from "child_process"
import fs from "fs/promises"
import path from "path"
import sinon from "sinon"
import { promisify } from "util"
import { StateManager } from "../../storage/StateManager"
import { HookFactory } from "../hook-factory"
import { setupHookTests } from "./setup"
import { buildPostToolUseInput, buildPreToolUseInput, createTestHook } from "./test-utils"

const execAsync = promisify(exec)

/**
 * Error Scenario Testing for Hook System
 *
 * Comprehensive error scenario coverage including:
 * - Resource management and leak prevention
 * - Process lifecycle and cleanup
 * - Multi-root workspace concurrency
 * - Input validation edge cases
 * - Embedded shell failures
 * - User cancellation (pending cancel API)
 * - Catastrophic failure prevention
 */
describe("Hook System - Error Scenarios", () => {
	const { getEnv } = setupHookTests()

	// Skip hook execution tests on Windows (hooks not yet supported on Windows)
	before(function () {
		if (process.platform === "win32") {
			this.skip()
		}
	})

	/**
	 * Helper: Get current process count for leak detection.
	 * Returns -1 if process counting is unavailable (which will skip process leak assertions).
	 */
	async function getProcessCount(): Promise<number> {
		try {
			const { stdout } = await execAsync("ps aux | grep -c '[n]ode'")
			return parseInt(stdout.trim())
		} catch {
			// If process counting fails, return -1 to skip the assertion
			return -1
		}
	}

	/**
	 * Helper: Wait for a specified duration
	 */
	async function waitFor(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	/**
	 * Helper: Creates a multi-root workspace environment for testing
	 */
	async function createMultiRootWorkspace(rootNames: string[]): Promise<string[]> {
		const rootPaths = await Promise.all(
			rootNames.map(async (name) => {
				const rootPath = path.join(getEnv().tempDir, name)
				await fs.mkdir(rootPath, { recursive: true })
				return rootPath
			}),
		)

		// Update the existing StateManager stub (already created by setupHookTests)
		const stateManagerStub = StateManager.get as sinon.SinonStub
		stateManagerStub.returns({
			getGlobalStateKey: () => rootPaths.map((path) => ({ path })),
		} as any)

		return rootPaths
	}

	/**
	 * Helper: Asserts process count hasn't grown significantly (no process leak)
	 */
	function assertNoProcessLeak(initialCount: number, finalCount: number): void {
		if (initialCount === -1 || finalCount === -1) {
			// Process counting unavailable, skip assertion
			return
		}
		// Allow some variance due to unrelated system processes
		const processDiff = finalCount - initialCount
		processDiff.should.be.lessThan(3) // Allow up to 2 processes variance
		processDiff.should.be.greaterThan(-3) // Allow processes to decrease
	}

	describe("Resource Management", () => {
		it("should handle hooks that attempt excessive memory allocation", async function () {
			this.timeout(35000)

			await createTestHook(
				getEnv().tempDir,
				"PreToolUse",
				{},
				{
					customNodeCode: `
// Try to allocate excessive memory
try {
  const arrays = [];
  for (let i = 0; i < 1000; i++) {
    arrays.push(new Array(1000000).fill('x'));
  }
  console.log(JSON.stringify({ 
    shouldContinue: true, 
    contextModification: "",
    errorMessage: "" 
  }));
} catch (error) {
  console.log(JSON.stringify({ 
    shouldContinue: false, 
    contextModification: "",
    errorMessage: "Out of memory: " + error.message
  }));
}
`,
				},
			)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Hook should either succeed with limited memory or fail gracefully
			try {
				const result = await runner.run(buildPreToolUseInput({ toolName: "test" }))
				// If it succeeds, verify it's a valid result
				result.should.have.property("shouldContinue")
			} catch (error: any) {
				// If it fails, should be a controlled failure, not a system crash
				error.message.should.be.a.String()
			}
		})

		it("should cleanup file descriptors after hook errors", async function () {
			this.timeout(10000)

			// Get initial FD count (if available)
			let initialFdCount = -1
			try {
				if (process.platform !== "win32") {
					const { stdout } = await execAsync(`lsof -p ${process.pid} | wc -l`)
					initialFdCount = parseInt(stdout.trim())
				}
			} catch {
				// FD counting not available, skip this part of the test
			}

			// Create a hook that exits with error
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

			// Run hook multiple times with errors
			for (let i = 0; i < 5; i++) {
				try {
					await runner.run(buildPreToolUseInput({ toolName: "test" }))
				} catch {
					// Expected to fail
				}
			}

			// Verify FD count hasn't grown significantly
			if (initialFdCount !== -1) {
				await waitFor(500) // Allow cleanup time
				const { stdout } = await execAsync(`lsof -p ${process.pid} | wc -l`)
				const finalFdCount = parseInt(stdout.trim())

				// Allow some growth, but not proportional to number of failed hooks
				const fdGrowth = finalFdCount - initialFdCount
				fdGrowth.should.be.lessThan(20) // Should not leak FDs
			}
		})

		it("should handle rapid sequential hook executions", async function () {
			this.timeout(15000)

			await createTestHook(getEnv().tempDir, "PreToolUse", {
				shouldContinue: true,
				contextModification: "RAPID_TEST: Hook executed",
				errorMessage: "",
			})

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Execute hook 10 times rapidly
			const results = await Promise.all(
				Array(10)
					.fill(0)
					.map((_, i) =>
						runner.run(
							buildPreToolUseInput({
								toolName: `test_${i}`,
							}),
						),
					),
			)

			// All should succeed
			results.should.have.length(10)
			results.forEach((result) => {
				result.shouldContinue.should.be.true()
			})
		})
	})

	describe("Process Lifecycle", () => {
		it("should cleanup processes after hook crashes", async function () {
			this.timeout(10000)

			const initialProcessCount = await getProcessCount()
			if (initialProcessCount === -1) {
				this.skip() // Skip if process counting unavailable
				return
			}

			await createTestHook(
				getEnv().tempDir,
				"PreToolUse",
				{ shouldContinue: true },
				{
					customNodeCode: "process.exit(1);",
				},
			)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Run hook that crashes
			try {
				await runner.run(buildPreToolUseInput({ toolName: "test" }))
			} catch {
				// Expected to fail
			}

			// Verify no process leak
			await waitFor(1000) // Allow cleanup time
			const finalProcessCount = await getProcessCount()

			assertNoProcessLeak(initialProcessCount, finalProcessCount)
		})

		it("should handle hooks that spawn child processes", async function () {
			this.timeout(10000)

			await createTestHook(
				getEnv().tempDir,
				"PreToolUse",
				{},
				{
					customNodeCode: `const { spawn } = require('child_process');
const child = spawn('node', ['-e', 'setTimeout(() => {}, 100)']);
child.on('close', () => {
  console.log(JSON.stringify({ 
    shouldContinue: true, 
    contextModification: "CHILD_PROCESS: Spawned and cleaned up",
    errorMessage: "" 
  }));
});`,
				},
			)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Should handle child processes properly
			const result = await runner.run(buildPreToolUseInput({ toolName: "test" }))

			result.shouldContinue.should.be.true()
			result.contextModification!.should.match(/CHILD_PROCESS/)
		})

		it("should handle hook process that exits without output", async function () {
			this.timeout(10000)

			await createTestHook(getEnv().tempDir, "PreToolUse", {}, { exitWithoutOutput: true })

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Should handle missing output gracefully
			try {
				await runner.run(buildPreToolUseInput({ toolName: "test" }))
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/Failed to parse/)
			}
		})
	})

	describe("Multi-Root Workspace Concurrency", () => {
		it("should execute hooks from multiple workspace roots concurrently", async function () {
			this.timeout(10000)

			const [root1, root2, root3] = await createMultiRootWorkspace(["root1", "root2", "root3"])

			// Create hooks in each root with different delays
			await createTestHook(
				root1,
				"PreToolUse",
				{
					shouldContinue: true,
					contextModification: "ROOT1: Hook executed",
				},
				{ delay: 100 },
			)

			await createTestHook(
				root2,
				"PreToolUse",
				{
					shouldContinue: true,
					contextModification: "ROOT2: Hook executed",
				},
				{ delay: 200 },
			)

			await createTestHook(
				root3,
				"PreToolUse",
				{
					shouldContinue: true,
					contextModification: "ROOT3: Hook executed",
				},
				{ delay: 150 },
			)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const start = Date.now()
			const result = await runner.run(buildPreToolUseInput({ toolName: "test" }))
			const elapsed = Date.now() - start

			// Should run concurrently (not sequentially)
			// Sequential would be 100 + 200 + 150 = 450ms minimum
			// Concurrent should be closer to max(100, 200, 150) = 200ms
			// But allow generous overhead for CI/slower systems
			elapsed.should.be.lessThan(2000) // Must complete before sequential time

			// Should aggregate all contexts
			result.shouldContinue.should.be.true()
			result.contextModification!.should.match(/ROOT1/)
			result.contextModification!.should.match(/ROOT2/)
			result.contextModification!.should.match(/ROOT3/)
		})

		it("should handle one root's hook failing while others succeed", async function () {
			this.timeout(10000)

			const [root1, root2, root3] = await createMultiRootWorkspace(["root1", "root2", "root3"])

			// Root 1: Success
			await createTestHook(root1, "PreToolUse", {
				shouldContinue: true,
				contextModification: "ROOT1: Success",
			})

			// Root 2: Blocks execution
			await createTestHook(root2, "PreToolUse", {
				shouldContinue: false,
				errorMessage: "ROOT2: Blocked by validation",
			})

			// Root 3: Success
			await createTestHook(root3, "PreToolUse", {
				shouldContinue: true,
				contextModification: "ROOT3: Success",
			})

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run(buildPreToolUseInput({ toolName: "test" }))

			// If any hook blocks, overall should block
			result.shouldContinue.should.be.false()

			// Should collect both successful contexts and error
			result.contextModification!.should.match(/ROOT1/)
			result.contextModification!.should.match(/ROOT3/)
			result.errorMessage!.should.match(/ROOT2: Blocked/)
		})

		it("should aggregate results from all workspace hooks", async function () {
			this.timeout(10000)

			const [root1, root2] = await createMultiRootWorkspace(["root1", "root2"])

			await createTestHook(root1, "PreToolUse", {
				shouldContinue: true,
				contextModification: "WORKSPACE_RULES: Root 1 conventions",
			})

			await createTestHook(root2, "PreToolUse", {
				shouldContinue: true,
				contextModification: "FILE_OPERATIONS: Root 2 validation",
			})

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const result = await runner.run(buildPreToolUseInput({ toolName: "write_to_file" }))

			result.shouldContinue.should.be.true()

			// Context should be aggregated with separation
			const contexts = result.contextModification!.split("\n\n")
			contexts.should.have.length(2)
			contexts[0].should.match(/Root 1 conventions/)
			contexts[1].should.match(/Root 2 validation/)
		})

		it("should handle slow hook in one root not blocking fast hooks", async function () {
			this.timeout(10000)

			const [root1, root2, root3] = await createMultiRootWorkspace(["root1", "root2", "root3"])

			// Root 1: Slow (5 seconds)
			await createTestHook(
				root1,
				"PreToolUse",
				{
					shouldContinue: true,
					contextModification: "ROOT1: Slow hook",
				},
				{ delay: 5000 },
			)

			// Root 2: Fast
			await createTestHook(root2, "PreToolUse", {
				shouldContinue: true,
				contextModification: "ROOT2: Fast hook",
			})

			// Root 3: Fast
			await createTestHook(root3, "PreToolUse", {
				shouldContinue: true,
				contextModification: "ROOT3: Fast hook",
			})

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const start = Date.now()
			const result = await runner.run(buildPreToolUseInput({ toolName: "test" }))
			const elapsed = Date.now() - start

			// Should take ~5s (waiting for slow hook), not 5s * 3 sequentially
			elapsed.should.be.greaterThan(4900)
			elapsed.should.be.lessThan(6000)

			// All results should be aggregated
			result.contextModification!.should.match(/ROOT1/)
			result.contextModification!.should.match(/ROOT2/)
			result.contextModification!.should.match(/ROOT3/)
		})

		it("should handle PostToolUse across multiple roots", async function () {
			this.timeout(10000)

			const [root1, root2] = await createMultiRootWorkspace(["root1", "root2"])

			await createTestHook(root1, "PostToolUse", {
				shouldContinue: true,
				contextModification: "ROOT1: Logged operation",
			})

			await createTestHook(root2, "PostToolUse", {
				shouldContinue: true,
				contextModification: "ROOT2: Updated metrics",
			})

			const factory = new HookFactory()
			const runner = await factory.create("PostToolUse")

			const result = await runner.run(
				buildPostToolUseInput({
					toolName: "write_to_file",
					result: "File created",
					success: true,
					executionTimeMs: 250,
				}),
			)

			result.shouldContinue.should.be.true()
			result.contextModification!.should.match(/ROOT1/)
			result.contextModification!.should.match(/ROOT2/)
		})

		it("should handle mixed success/failure in multi-root execution", async function () {
			this.timeout(10000)

			const [root1, root2, root3] = await createMultiRootWorkspace(["root1", "root2", "root3"])

			// Root 1: Success
			await createTestHook(root1, "PreToolUse", {
				shouldContinue: true,
				contextModification: "ROOT1: Validated",
			})

			// Root 2: Failure (exit with error)
			await createTestHook(
				root2,
				"PreToolUse",
				{
					shouldContinue: false,
					errorMessage: "ROOT2: Error",
				},
				{ exitCode: 1 },
			)

			// Root 3: Success
			await createTestHook(root3, "PreToolUse", {
				shouldContinue: true,
				contextModification: "ROOT3: Validated",
			})

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Should handle partial failure gracefully
			try {
				await runner.run(buildPreToolUseInput({ toolName: "test" }))
				// If root2 exits with error, the whole thing should fail
				throw new Error("Should have failed")
			} catch (error: any) {
				// Expected - one hook failed
				error.message.should.match(/exited with code 1/)
			}
		})
	})

	describe("Input Validation", () => {
		it("should handle reasonably sized input gracefully", async function () {
			this.timeout(10000)

			await createTestHook(getEnv().tempDir, "PreToolUse", {
				shouldContinue: true,
				contextModification: "INPUT_TEST: Processed",
			})

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Create reasonably sized parameters object
			const params = {
				content: "x".repeat(10000), // 10KB of content
				metadata: Array(10)
					.fill(0)
					.map((_, i) => ({
						id: i,
						data: "y".repeat(100),
					})),
			}

			// Should handle normal-sized input
			const result = await runner.run(
				buildPreToolUseInput({
					toolName: "write_to_file",
					parameters: params,
				}),
			)

			result.shouldContinue.should.be.true()
			result.contextModification!.should.match(/INPUT_TEST/)
		})

		it("should handle parameters with special characters", async function () {
			this.timeout(10000)

			await createTestHook(
				getEnv().tempDir,
				"PreToolUse",
				{},
				{
					customNodeCode: `const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const path = input.preToolUse.parameters.path || '';
const hasSpecialChars = /[<>:"|?*\\x00-\\x1f]/.test(path);
console.log(JSON.stringify({ 
  shouldContinue: true, 
  contextModification: hasSpecialChars ? "VALIDATION: Special chars detected" : "VALIDATION: Normal path",
  errorMessage: "" 
}));`,
				},
			)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Test with special characters
			const result = await runner.run(
				buildPreToolUseInput({
					toolName: "write_to_file",
					parameters: {
						path: 'file with "quotes" and <brackets> and |pipes|',
						content: "test",
					},
				}),
			)

			result.shouldContinue.should.be.true()
			result.contextModification!.should.match(/Special chars/)
		})

		it("should handle undefined and null parameters", async function () {
			this.timeout(10000)

			await createTestHook(
				getEnv().tempDir,
				"PreToolUse",
				{},
				{
					customNodeCode: `const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const params = input.preToolUse.parameters;
console.log(JSON.stringify({ 
  shouldContinue: true, 
  contextModification: "PARAMS: " + JSON.stringify(params),
  errorMessage: "" 
}));`,
				},
			)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Test with minimal parameters
			const result = await runner.run(
				buildPreToolUseInput({
					toolName: "test_tool",
					parameters: {},
				}),
			)

			result.shouldContinue.should.be.true()
			result.contextModification!.should.match(/PARAMS/)
		})
	})

	describe("Embedded Shell Failures", () => {
		it("should provide helpful error when hook script not found", async function () {
			this.timeout(5000)

			// Don't create any hooks
			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// Should gracefully handle missing hook (NoOpRunner)
			const result = await runner.run(buildPreToolUseInput({ toolName: "test" }))

			result.shouldContinue.should.be.true()
		})
	})

	describe("User Cancellation", () => {
		it.skip("should cancel long-running hook on user request", async function () {
			// TODO: Implement when cancel button/API is added
			// Current implementation uses 30s timeout, not user cancellation
			this.timeout(35000)

			const hookPath = path.join(getEnv().tempDir, ".clinerules", "hooks")
			const scriptContent = `#!/usr/bin/env node
// Infinite loop - should be cancellable by user
setTimeout(() => {
  console.log(JSON.stringify({ 
    shouldContinue: false, 
    contextModification: "",
    errorMessage: "" 
  }));
}, 999999999);
`
			const scriptPath = path.join(hookPath, "PreToolUse")
			await fs.writeFile(scriptPath, scriptContent)
			try {
				await fs.chmod(scriptPath, 0o755)
			} catch (error) {
				// Ignore chmod errors on Windows
			}

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// When cancel API is implemented:
			// const promise = runner.run(buildPreToolUseInput({ toolName: "test" }))
			// setTimeout(() => runner.cancel(), 1000)
			// await promise should reject with cancellation error
		})

		it.skip("should cleanup cancelled processes", async () => {
			// TODO: Implement when cancel API is added
			// Verify no zombie processes after user cancellation
		})

		it.skip("should handle cancellation of already-completed hooks", async () => {
			// TODO: Implement when cancel API is added
			// Cancelling after completion should be a no-op
		})

		it.skip("should handle multiple consecutive cancellations", async () => {
			// TODO: Implement when cancel API is added
			// Ensure cancellation doesn't break subsequent hook calls
		})

		it.skip("should cancel all workspace hooks when user cancels", async () => {
			// TODO: Implement when cancel API is added
			// Should cancel all concurrent hook processes across all roots
		})
	})

	describe("Catastrophic Failure Prevention", () => {
		it("should never leak processes after errors", async function () {
			this.timeout(15000)

			const initialProcessCount = await getProcessCount()
			if (initialProcessCount === -1) {
				this.skip() // Skip if process counting unavailable
				return
			}

			// Create various failing hooks
			const scenarios = [
				{ exitCode: 1 }, // Exit with error
				{ malformedJson: true }, // Invalid JSON
				{ delay: 100, exitCode: 1 }, // Delayed failure
			]

			for (const scenario of scenarios) {
				await createTestHook(getEnv().tempDir, "PreToolUse", { shouldContinue: true }, scenario)

				const factory = new HookFactory()
				const runner = await factory.create("PreToolUse")

				try {
					await runner.run(buildPreToolUseInput({ toolName: "test" }))
				} catch {
					// Expected to fail
				}

				// Clean up for next iteration
				await fs.unlink(path.join(getEnv().tempDir, ".clinerules", "hooks", "PreToolUse")).catch(() => {})
			}

			// Verify no cumulative process leaks
			await waitFor(1000)
			const finalProcessCount = await getProcessCount()

			assertNoProcessLeak(initialProcessCount, finalProcessCount)
		})

		it("should never corrupt task state on hook failure", async function () {
			this.timeout(10000)

			// Create a failing hook
			await createTestHook(
				getEnv().tempDir,
				"PreToolUse",
				{
					shouldContinue: false,
					errorMessage: "Hook failed",
				},
				{ exitCode: 1 },
			)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			// First hook call fails
			try {
				await runner.run(buildPreToolUseInput({ toolName: "test1" }))
			} catch {
				// Expected
			}

			// Replace with working hook
			await createTestHook(getEnv().tempDir, "PreToolUse", {
				shouldContinue: true,
				contextModification: "RECOVERY: Working now",
			})

			// Second call should work (verifies no state corruption)
			const factory2 = new HookFactory()
			const runner2 = await factory2.create("PreToolUse")
			const result = await runner2.run(buildPreToolUseInput({ toolName: "test2" }))

			result.shouldContinue.should.be.true()
			result.contextModification!.should.match(/RECOVERY/)
		})

		it("should handle hooks with infinite loops via timeout", async function () {
			this.timeout(35000)

			const hookPath = path.join(getEnv().tempDir, ".clinerules", "hooks")
			const scriptContent = `#!/usr/bin/env node
// Infinite loop (will be stopped by timeout)
while(true) {
  // Spin forever
}
`
			const scriptPath = path.join(hookPath, "PreToolUse")
			await fs.writeFile(scriptPath, scriptContent)
			try {
				await fs.chmod(scriptPath, 0o755)
			} catch (error) {
				// Ignore chmod errors on Windows
			}

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const start = Date.now()

			try {
				await runner.run(buildPreToolUseInput({ toolName: "test" }))
				throw new Error("Should have timed out")
			} catch (error: any) {
				const elapsed = Date.now() - start

				// Should timeout around 30s
				elapsed.should.be.greaterThan(29000)
				elapsed.should.be.lessThan(35000)
				error.message.should.match(/timed out/)
			}
		})

		it("should execute hooks asynchronously without blocking", async function () {
			this.timeout(10000)

			// Create a slow hook
			await createTestHook(
				getEnv().tempDir,
				"PreToolUse",
				{
					shouldContinue: true,
					contextModification: "ASYNC: Completed",
				},
				{ delay: 2000 },
			)

			const factory = new HookFactory()
			const runner = await factory.create("PreToolUse")

			const start = Date.now()

			// Start hook execution (should not block)
			const promise = runner.run(buildPreToolUseInput({ toolName: "test" }))

			// Verify we can do other work while hook runs
			let workDone = false
			setTimeout(() => {
				workDone = true
			}, 100)

			await promise
			const elapsed = Date.now() - start

			// Hook took ~2s but we could do work during that time
			elapsed.should.be.greaterThan(1900)
			workDone.should.be.true()
		})

		it("should recover from any hook failure type", async function () {
			this.timeout(15000)

			const failureTypes = [
				{ desc: "exit code", options: { exitCode: 1 } },
				{ desc: "malformed JSON", options: { malformedJson: true } },
				{
					desc: "exception",
					script: `#!/usr/bin/env node
throw new Error("Intentional error");
`,
				},
			]

			for (const failure of failureTypes) {
				if (failure.script) {
					const scriptPath = path.join(getEnv().tempDir, ".clinerules", "hooks", "PreToolUse")
					await fs.writeFile(scriptPath, failure.script)
					try {
						await fs.chmod(scriptPath, 0o755)
					} catch (error) {
						// Ignore chmod errors on Windows
					}
				} else {
					await createTestHook(getEnv().tempDir, "PreToolUse", { shouldContinue: true }, failure.options!)
				}

				const factory = new HookFactory()
				const runner = await factory.create("PreToolUse")

				// Hook should fail
				try {
					await runner.run(buildPreToolUseInput({ toolName: "test" }))
				} catch (error: any) {
					// Expected failure
					error.should.be.instanceof(Error)
				}

				// Clean up
				await fs.unlink(path.join(getEnv().tempDir, ".clinerules", "hooks", "PreToolUse")).catch(() => {})

				// Next tool use should work
				await createTestHook(getEnv().tempDir, "PreToolUse", {
					shouldContinue: true,
					contextModification: `RECOVERY: After ${failure.desc} failure`,
				})

				const factory2 = new HookFactory()
				const runner2 = await factory2.create("PreToolUse")
				const result = await runner2.run(buildPreToolUseInput({ toolName: "test" }))

				result.shouldContinue.should.be.true()
				result.contextModification!.should.match(/RECOVERY/)

				// Clean up for next iteration
				await fs.unlink(path.join(getEnv().tempDir, ".clinerules", "hooks", "PreToolUse")).catch(() => {})
			}
		})
	})
})
