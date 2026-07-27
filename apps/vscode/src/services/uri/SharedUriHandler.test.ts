import { afterEach, beforeEach, describe, it } from "bun:test"
import { expect } from "chai"
import * as sinon from "sinon"
import { WebviewProvider } from "@/core/webview"
import { Logger } from "@/shared/services/Logger"

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

		describe("Removed webhook task URI handling", () => {
			it("rejects the legacy LG task path without reading files or creating a task", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://bedrockCoder.bedrock-coder/lg-task?prompt-file=C%3A%5Cprivate%5Cspec.md&webhook-url=https%3A%2F%2Fexample.com&webhook-token=secret",
				)

				expect(result).to.be.false
				expect(handleTaskCreationStub.called).to.be.false
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
