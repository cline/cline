/**
 * Tests for HookManager
 */

import { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { ClineDefaultTool } from "@/shared/tools"
import { HookConfigurationLoader } from "./HookConfiguration"
import { HookExecutor } from "./HookExecutor"
import { HookManager } from "./HookManager"

describe("HookManager", () => {
	let manager: HookManager
	let sandbox: sinon.SinonSandbox
	let configLoaderStub: sinon.SinonStubbedInstance<HookConfigurationLoader>
	let executorStub: sinon.SinonStubbedInstance<HookExecutor>

	const mockToolBlock: ToolUse = {
		type: "tool_use",
		name: ClineDefaultTool.FILE_READ,
		params: { path: "/test.txt" },
		partial: false,
	}

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Create manager with test options
		manager = new HookManager("test-task", "/workspace", {
			debug: false,
		})

		// Stub the internal dependencies
		configLoaderStub = sandbox.stub((manager as any).configLoader) as sinon.SinonStubbedInstance<HookConfigurationLoader>
		executorStub = sandbox.stub((manager as any).executor) as sinon.SinonStubbedInstance<HookExecutor>
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("isEnabled", () => {
		it("should return true when hooks are configured", async () => {
			configLoaderStub.hasHooks.resolves(true)

			const enabled = await manager.isEnabled()

			expect(enabled).to.be.true
			expect(configLoaderStub.hasHooks.calledOnce).to.be.true
		})

		it("should return false when no hooks are configured", async () => {
			configLoaderStub.hasHooks.resolves(false)

			const enabled = await manager.isEnabled()

			expect(enabled).to.be.false
		})
	})

	describe("executePreToolUseHooks", () => {
		it("should execute PreToolUse hooks with correct event", async () => {
			const mockConfig = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [{ type: "command" as const, command: "hook.js" }],
						},
					],
				},
			}

			const mockResults = [
				{
					response: { approve: true, message: "Approved" },
					exitCode: 0,
				},
			]

			configLoaderStub.getConfiguration.resolves(mockConfig)
			executorStub.executeHooksParallel.resolves(mockResults)

			const result = await manager.executePreToolUseHooks(mockToolBlock)

			expect(result).to.not.be.null
			expect(result?.approve).to.be.true
			expect(result?.messages).to.deep.equal(["Approved"])

			// Verify the event was created correctly
			const callArgs = executorStub.executeHooksParallel.firstCall.args
			const event = callArgs[1]
			expect(event.hook_event_name).to.equal("PreToolUse")
			expect((event as any).tool_name).to.equal("Read")
		})

		it("should return null when no matching hooks", async () => {
			const mockConfig = {
				hooks: {
					PreToolUse: [
						{
							matcher: "Write",
							hooks: [{ type: "command" as const, command: "hook.js" }],
						},
					],
				},
			}

			configLoaderStub.getConfiguration.resolves(mockConfig)

			const result = await manager.executePreToolUseHooks(mockToolBlock)

			expect(result).to.be.null
			expect(executorStub.executeHooksParallel.called).to.be.false
		})

		it("should handle hook denial", async () => {
			const mockConfig = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [{ type: "command" as const, command: "deny.js" }],
						},
					],
				},
			}

			const mockResults = [
				{
					response: { approve: false, message: "Access denied" },
					exitCode: 1,
				},
			]

			configLoaderStub.getConfiguration.resolves(mockConfig)
			executorStub.executeHooksParallel.resolves(mockResults)

			const result = await manager.executePreToolUseHooks(mockToolBlock)

			expect(result?.approve).to.be.false
			expect(result?.messages).to.include("Access denied")
		})
	})

	describe("executePostToolUseHooks", () => {
		it("should execute PostToolUse hooks with tool response", async () => {
			const mockConfig = {
				hooks: {
					PostToolUse: [
						{
							matcher: "*",
							hooks: [{ type: "command" as const, command: "post-hook.js" }],
						},
					],
				},
			}

			const mockResults = [
				{
					response: {
						approve: true,
						modifiedOutput: { result: "modified" },
					},
					exitCode: 0,
				},
			]

			const toolResponse = { output: "original" }

			configLoaderStub.getConfiguration.resolves(mockConfig)
			executorStub.executeHooksParallel.resolves(mockResults)

			const result = await manager.executePostToolUseHooks(mockToolBlock, toolResponse)

			expect(result).to.not.be.null
			expect(result?.modifiedOutput).to.deep.equal({ result: "modified" })

			// Verify the event includes tool response
			const callArgs = executorStub.executeHooksParallel.firstCall.args
			const event = callArgs[1]
			expect((event as any).tool_response).to.deep.equal(toolResponse)
		})
	})

	describe("executeUserPromptSubmitHooks", () => {
		it("should execute UserPromptSubmit hooks", async () => {
			const mockConfig = {
				hooks: {
					UserPromptSubmit: [
						{
							matcher: "*",
							hooks: [{ type: "command" as const, command: "prompt-hook.js" }],
						},
					],
				},
			}

			const mockResults = [
				{
					response: {
						approve: true,
						additionalContext: "Extra context",
					},
					exitCode: 0,
				},
			]

			configLoaderStub.getConfiguration.resolves(mockConfig)
			executorStub.executeHooksParallel.resolves(mockResults)

			const prompt = "Test prompt"
			const result = await manager.executeUserPromptSubmitHooks(prompt)

			expect(result).to.not.be.null
			expect(result?.additionalContext).to.deep.equal(["Extra context"])

			// Verify the event includes the prompt
			const callArgs = executorStub.executeHooksParallel.firstCall.args
			const event = callArgs[1]
			expect((event as any).prompt).to.equal(prompt)
		})
	})

	describe("executeStopHooks", () => {
		it("should execute Stop hooks", async () => {
			const mockConfig = {
				hooks: {
					Stop: [
						{
							matcher: "*",
							hooks: [{ type: "command" as const, command: "stop-hook.js" }],
						},
					],
				},
			}

			const mockResults = [
				{
					response: { approve: true },
					exitCode: 0,
				},
			]

			configLoaderStub.getConfiguration.resolves(mockConfig)
			executorStub.executeHooksParallel.resolves(mockResults)

			const result = await manager.executeStopHooks(true)

			expect(result).to.not.be.null

			// Verify stop_hook_active flag
			const callArgs = executorStub.executeHooksParallel.firstCall.args
			const event = callArgs[1]
			expect((event as any).stop_hook_active).to.be.true
		})
	})

	describe("executeSessionStartHooks", () => {
		it("should execute SessionStart hooks with source", async () => {
			const mockConfig = {
				hooks: {
					SessionStart: [
						{
							matcher: "*",
							hooks: [{ type: "command" as const, command: "session-hook.js" }],
						},
					],
				},
			}

			const mockResults = [
				{
					response: { approve: true },
					exitCode: 0,
				},
			]

			configLoaderStub.getConfiguration.resolves(mockConfig)
			executorStub.executeHooksParallel.resolves(mockResults)

			const result = await manager.executeSessionStartHooks("startup")

			expect(result).to.not.be.null

			// Verify source is included
			const callArgs = executorStub.executeHooksParallel.firstCall.args
			const event = callArgs[1]
			expect((event as any).source).to.equal("startup")
		})
	})

	describe("parallel vs sequential execution", () => {
		it("should use parallel execution by default", async () => {
			const mockConfig = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{ type: "command" as const, command: "hook1.js" },
								{ type: "command" as const, command: "hook2.js" },
							],
						},
					],
				},
			}

			configLoaderStub.getConfiguration.resolves(mockConfig)
			executorStub.executeHooksParallel.resolves([])

			await manager.executePreToolUseHooks(mockToolBlock)

			expect(executorStub.executeHooksParallel.called).to.be.true
			expect(executorStub.executeHooksSequential.called).to.be.false
		})

		it("should use sequential execution when configured", async () => {
			const mockConfig = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{ type: "command" as const, command: "hook1.js" },
								{ type: "command" as const, command: "hook2.js" },
							],
						},
					],
				},
				settings: {
					parallel: false,
				},
			}

			configLoaderStub.getConfiguration.resolves(mockConfig)
			executorStub.executeHooksSequential.resolves([])

			await manager.executePreToolUseHooks(mockToolBlock)

			expect(executorStub.executeHooksSequential.called).to.be.true
			expect(executorStub.executeHooksParallel.called).to.be.false
		})
	})

	describe("error handling", () => {
		it("should return null on configuration error", async () => {
			configLoaderStub.getConfiguration.rejects(new Error("Config error"))

			const result = await manager.executePreToolUseHooks(mockToolBlock)

			expect(result).to.be.null
		})

		it("should return null on execution error", async () => {
			const mockConfig = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [{ type: "command" as const, command: "hook.js" }],
						},
					],
				},
			}

			configLoaderStub.getConfiguration.resolves(mockConfig)
			executorStub.executeHooksParallel.rejects(new Error("Execution error"))

			const result = await manager.executePreToolUseHooks(mockToolBlock)

			expect(result).to.be.null
		})
	})

	describe("setTranscriptPath", () => {
		it("should update transcript path in transformer", () => {
			const setTranscriptPathSpy = sandbox.spy((manager as any).transformer, "setTranscriptPath")

			manager.setTranscriptPath("/new/path.json")

			expect(setTranscriptPathSpy.calledWith("/new/path.json")).to.be.true
		})
	})

	describe("reloadConfiguration", () => {
		it("should clear cache and reload configuration", async () => {
			configLoaderStub.getConfiguration.resolves({ hooks: {} })

			await manager.reloadConfiguration()

			expect(configLoaderStub.clearCache.calledOnce).to.be.true
			expect(configLoaderStub.getConfiguration.calledOnce).to.be.true
		})
	})
})
