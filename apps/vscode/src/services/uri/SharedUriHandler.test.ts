import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import { expect } from "chai"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import * as sinon from "sinon"
import { WebviewProvider } from "@/core/webview"
import * as actualWebhookHooks from "@/services/lg-cns-integration/webhook-hooks"
import { Logger } from "@/shared/services/Logger"

// bun loads real ESM, so sinon cannot stub the
// `@/services/lg-cns-integration/webhook-hooks` namespace exports ("ES Modules
// cannot be stubbed"). Inject module-level sinon stubs via mock.module so the
// full sinon stub API keeps working.
const writeLgWebhookConfigStub: sinon.SinonStub = sinon.stub()
const writeLgWebhookHooksStub: sinon.SinonStub = sinon.stub()
const webhookHooksMock = () => ({
	...actualWebhookHooks,
	writeLgWebhookConfig: writeLgWebhookConfigStub,
	writeLgWebhookHooks: writeLgWebhookHooksStub,
})
mock.module("@/services/lg-cns-integration/webhook-hooks", webhookHooksMock)
mock.module("@services/lg-cns-integration/webhook-hooks", webhookHooksMock)

import { SharedUriHandler } from "./SharedUriHandler"

describe("SharedUriHandler", () => {
	let sandbox: sinon.SinonSandbox
	let handleTaskCreationStub: sinon.SinonStub

	beforeEach(async () => {
		sandbox = sinon.createSandbox()

		// Mock Logger methods to avoid HostProvider dependency
		sandbox.stub(Logger, "info").returns()
		sandbox.stub(Logger, "error").returns()
		handleTaskCreationStub = sandbox.stub().resolves()
		const mockWebviewProvider = {
			controller: {
				handleTaskCreation: handleTaskCreationStub,
			},
		} as any
		sandbox.stub(WebviewProvider, "getVisibleInstance").returns(mockWebviewProvider)
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("handleUri", () => {
		describe("Unknown path handling", () => {
			it("should return false for unknown paths", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bedrockCoder.bedrock-coder/unknown?param=value")

				expect(result).to.be.false
			})
		})

		describe("LG task URI handling", () => {
			it("should setup webhook files and create task from prompt-file", async () => {
				const webhookUrl = "https://example.com/api/updates"
				const webhookToken = "token-123"
				const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lg-task-uri-"))
				try {
					const promptFilePath = path.join(tempDir, "lg-spec.md")
					await fs.writeFile(promptFilePath, "Implement user registration flow", "utf-8")

					const writeConfigStub = writeLgWebhookConfigStub
					writeConfigStub.reset()
					writeConfigStub.resolves()
					const writeHooksStub = writeLgWebhookHooksStub
					writeHooksStub.reset()
					writeHooksStub.resolves()

					const result = await SharedUriHandler.handleUri(
						`vscode://bedrockCoder.bedrock-coder/lg-task?prompt-file=${encodeURIComponent(
							promptFilePath,
						)}&webhook-url=${encodeURIComponent(webhookUrl)}&webhook-token=${encodeURIComponent(webhookToken)}`,
					)

					expect(result).to.be.true
					sinon.assert.calledOnce(handleTaskCreationStub)
					const taskPrompt = handleTaskCreationStub.firstCall.args[0] as string
					expect(taskPrompt).to.contain(promptFilePath)
					expect(taskPrompt).to.contain("Implement user registration flow")
					expect(taskPrompt).to.contain("re-read")
					sinon.assert.calledOnceWithExactly(writeConfigStub, webhookUrl, webhookToken)
					sinon.assert.calledOnce(writeHooksStub)
				} finally {
					await fs.rm(tempDir, { recursive: true, force: true })
				}
			})

			it("should return false when LG task parameters are missing", async () => {
				const writeConfigStub = writeLgWebhookConfigStub
				writeConfigStub.reset()
				writeConfigStub.resolves()
				const writeHooksStub = writeLgWebhookHooksStub
				writeHooksStub.reset()
				writeHooksStub.resolves()
				const result = await SharedUriHandler.handleUri(
					"vscode://bedrockCoder.bedrock-coder/lg-task?prompt-file=%2Ftmp%2Fspec.md&webhook-url=https%3A%2F%2Fexample.com",
				)

				expect(result).to.be.false
				expect(handleTaskCreationStub.called).to.be.false
				expect(writeConfigStub.called).to.be.false
				expect(writeHooksStub.called).to.be.false
			})
		})

		describe("Error handling", () => {
			it("should handle malformed URIs gracefully", async () => {
				const result = await SharedUriHandler.handleUri("invalid://uri")

				expect(result).to.be.false
			})
		})
	})
})
