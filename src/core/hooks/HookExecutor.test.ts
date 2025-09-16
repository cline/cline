/**
 * Tests for HookExecutor
 */

import { expect } from "chai"
import * as execa from "execa"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { HookExecutor } from "./HookExecutor"
import { HookDefinition } from "./types/HookConfiguration"
import { PreToolUseEvent } from "./types/HookEvent"

describe("HookExecutor", () => {
	let executor: HookExecutor
	let sandbox: sinon.SinonSandbox
	let execaStub: sinon.SinonStub

	const mockEvent: PreToolUseEvent = {
		session_id: "test-session",
		transcript_path: "/path/to/transcript",
		cwd: "/workspace",
		hook_event_name: "PreToolUse",
		tool_name: "Read",
		tool_input: { path: "/test.txt" },
	}

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		executor = new HookExecutor()

		// Stub execa
		execaStub = sandbox.stub(execa, "execa")
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("executeHook", () => {
		it("should execute a hook command successfully", async () => {
			const hook: HookDefinition = {
				type: "command",
				command: "echo",
			}

			const mockResult = {
				stdout: JSON.stringify({ approve: true, message: "Hook approved" }),
				stderr: "",
				exitCode: 0,
				timedOut: false,
			}

			execaStub.resolves(mockResult)

			const result = await executor.executeHook(hook, mockEvent)

			expect(result.response?.approve).to.equal(true)
			expect(result.response?.message).to.equal("Hook approved")
			expect(result.exitCode).to.equal(0)
			expect(result.timedOut).to.be.undefined
		})

		it("should handle hook denial", async () => {
			const hook: HookDefinition = {
				type: "command",
				command: "deny-hook",
			}

			const mockResult = {
				stdout: "",
				stderr: "Access denied",
				exitCode: 1,
				timedOut: false,
			}

			execaStub.resolves(mockResult)

			const result = await executor.executeHook(hook, mockEvent)

			expect(result.response?.approve).to.equal(false)
			expect(result.response?.message).to.equal("Access denied")
			expect(result.exitCode).to.equal(1)
		})

		it("should handle hook timeout", async () => {
			const hook: HookDefinition = {
				type: "command",
				command: "slow-hook",
				timeout: 1, // 1 second timeout
			}

			const mockResult = {
				stdout: "",
				stderr: "",
				exitCode: undefined,
				timedOut: true,
			}

			execaStub.resolves(mockResult)

			const result = await executor.executeHook(hook, mockEvent)

			expect(result.timedOut).to.equal(true)
			expect(result.response).to.be.undefined
		})

		it("should pass environment variables", async () => {
			const hook: HookDefinition = {
				type: "command",
				command: "echo",
				environment: {
					CUSTOM_VAR: "custom_value",
				},
			}

			const mockResult = {
				stdout: JSON.stringify({ approve: true }),
				stderr: "",
				exitCode: 0,
				timedOut: false,
			}

			execaStub.resolves(mockResult)

			await executor.executeHook(hook, mockEvent)

			const callArgs = execaStub.firstCall.args
			expect(callArgs[2].env).to.include({
				CUSTOM_VAR: "custom_value",
				CLAUDE_PROJECT_DIR: "/workspace",
			})
		})

		it("should handle command with arguments", async () => {
			const hook: HookDefinition = {
				type: "command",
				command: ["node", "hook.js", "--verbose"],
			}

			const mockResult = {
				stdout: JSON.stringify({ approve: true }),
				stderr: "",
				exitCode: 0,
				timedOut: false,
			}

			execaStub.resolves(mockResult)

			await executor.executeHook(hook, mockEvent)

			const callArgs = execaStub.firstCall.args
			expect(callArgs[0]).to.equal("node")
			expect(callArgs[1]).to.deep.equal(["hook.js", "--verbose"])
		})

		it("should pass event as JSON to stdin", async () => {
			const hook: HookDefinition = {
				type: "command",
				command: "process-event",
			}

			const mockResult = {
				stdout: JSON.stringify({ approve: true }),
				stderr: "",
				exitCode: 0,
				timedOut: false,
			}

			execaStub.resolves(mockResult)

			await executor.executeHook(hook, mockEvent)

			const callArgs = execaStub.firstCall.args
			expect(callArgs[2].input).to.equal(JSON.stringify(mockEvent))
		})

		it("should handle execution errors", async () => {
			const hook: HookDefinition = {
				type: "command",
				command: "missing-command",
			}

			const error = new Error("Command not found") as any
			error.exitCode = 127

			execaStub.rejects(error)

			const result = await executor.executeHook(hook, mockEvent)

			expect(result.error).to.equal("Command not found")
			expect(result.exitCode).to.equal(127)
		})

		it("should track execution time", async () => {
			const hook: HookDefinition = {
				type: "command",
				command: "echo",
			}

			const mockResult = {
				stdout: JSON.stringify({ approve: true }),
				stderr: "",
				exitCode: 0,
				timedOut: false,
			}

			// Simulate some delay
			execaStub.callsFake(
				() =>
					new Promise((resolve) => {
						setTimeout(() => resolve(mockResult), 10)
					}),
			)

			const result = await executor.executeHook(hook, mockEvent)

			expect(result.executionTime).to.be.a("number")
			expect(result.executionTime).to.be.at.least(10)
		})
	})

	describe("executeHooksParallel", () => {
		it("should execute multiple hooks in parallel", async () => {
			const hooks: HookDefinition[] = [
				{ type: "command", command: "hook1" },
				{ type: "command", command: "hook2" },
				{ type: "command", command: "hook3" },
			]

			const results = [
				{ stdout: JSON.stringify({ approve: true, message: "Hook 1" }), stderr: "", exitCode: 0 },
				{ stdout: JSON.stringify({ approve: true, message: "Hook 2" }), stderr: "", exitCode: 0 },
				{ stdout: JSON.stringify({ approve: true, message: "Hook 3" }), stderr: "", exitCode: 0 },
			]

			results.forEach((result, index) => {
				execaStub.onCall(index).resolves({ ...result, timedOut: false })
			})

			const hookResults = await executor.executeHooksParallel(hooks, mockEvent)

			expect(hookResults).to.have.length(3)
			expect(hookResults[0].response?.message).to.equal("Hook 1")
			expect(hookResults[1].response?.message).to.equal("Hook 2")
			expect(hookResults[2].response?.message).to.equal("Hook 3")

			// All hooks should be called
			expect(execaStub.callCount).to.equal(3)
		})
	})

	describe("executeHooksSequential", () => {
		it("should execute hooks sequentially", async () => {
			const hooks: HookDefinition[] = [
				{ type: "command", command: "hook1" },
				{ type: "command", command: "hook2" },
				{ type: "command", command: "hook3" },
			]

			const results = [
				{ stdout: JSON.stringify({ approve: true, message: "Hook 1" }), stderr: "", exitCode: 0 },
				{ stdout: JSON.stringify({ approve: true, message: "Hook 2" }), stderr: "", exitCode: 0 },
				{ stdout: JSON.stringify({ approve: true, message: "Hook 3" }), stderr: "", exitCode: 0 },
			]

			const callOrder: string[] = []

			results.forEach((result, index) => {
				execaStub.onCall(index).callsFake(() => {
					callOrder.push(`hook${index + 1}`)
					return Promise.resolve({ ...result, timedOut: false })
				})
			})

			const hookResults = await executor.executeHooksSequential(hooks, mockEvent)

			expect(hookResults).to.have.length(3)
			expect(callOrder).to.deep.equal(["hook1", "hook2", "hook3"])
		})

		it("should stop on first denial", async () => {
			const hooks: HookDefinition[] = [
				{ type: "command", command: "hook1" },
				{ type: "command", command: "hook2" },
				{ type: "command", command: "hook3" },
			]

			execaStub
				.onCall(0)
				.resolves({
					stdout: JSON.stringify({ approve: true }),
					stderr: "",
					exitCode: 0,
					timedOut: false,
				})
				.onCall(1)
				.resolves({
					stdout: JSON.stringify({ approve: false, message: "Denied by hook 2" }),
					stderr: "",
					exitCode: 0,
					timedOut: false,
				})

			const hookResults = await executor.executeHooksSequential(hooks, mockEvent)

			// Should only execute first two hooks
			expect(hookResults).to.have.length(2)
			expect(hookResults[0].response?.approve).to.equal(true)
			expect(hookResults[1].response?.approve).to.equal(false)

			// Third hook should not be called
			expect(execaStub.callCount).to.equal(2)
		})
	})
})
