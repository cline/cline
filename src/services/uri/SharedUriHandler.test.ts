import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { WebviewProvider } from "@/core/webview"
import { ErrorService } from "../error"
import { Logger } from "../logging/Logger"
import { SharedUriHandler } from "./SharedUriHandler"

describe("SharedUriHandler", () => {
	let sandbox: sinon.SinonSandbox
	let handleOpenRouterCallbackStub: sinon.SinonStub
	let handleAuthCallbackStub: sinon.SinonStub

	beforeEach(async () => {
		sandbox = sinon.createSandbox()

		// Mock Logger methods to avoid HostProvider dependency
		sandbox.stub(Logger, "info").returns()
		sandbox.stub(Logger, "error").returns()
		// Mock ErrorService to avoid telemetry dependency
		const mockErrorService = {
			logMessage: sandbox.stub(),
			logException: sandbox.stub(),
			toClineError: sandbox.stub(),
			isEnabled: sandbox.stub().returns(false),
			getSettings: sandbox.stub().returns({ enabled: false, hostEnabled: false }),
			getProvider: sandbox.stub(),
			dispose: sandbox.stub().resolves(),
		}
		sandbox.stub(ErrorService, "initialize").resolves(mockErrorService as any)
		sandbox.stub(ErrorService, "get").returns(mockErrorService as any)

		await ErrorService.initialize()

		handleOpenRouterCallbackStub = sandbox.stub().resolves()
		handleAuthCallbackStub = sandbox.stub().resolves()
		const mockWebviewProvider = {
			controller: {
				handleOpenRouterCallback: handleOpenRouterCallbackStub,
				handleAuthCallback: handleAuthCallbackStub,
			},
		} as any
		sandbox.stub(WebviewProvider, "getVisibleInstance").returns(mockWebviewProvider)
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("handleUri", () => {
		describe("OpenRouter callback handling", () => {
			it("should successfully handle OpenRouter callback with code", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/openrouter?code=test123")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test123")
			})

			it("should return false when OpenRouter code is missing", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/openrouter")

				expect(result).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})

			it("should handle URL with plus signs in code parameter", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/openrouter?code=test+123+abc")

				expect(result).to.be.true
				// Plus signs in query params are preserved
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test+123+abc")
			})
		})

		describe("Auth callback handling", () => {
			it("should successfully handle auth callback with idToken", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/auth?idToken=jwt123&provider=google")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleAuthCallbackStub, "jwt123", "google")
			})

			it("should successfully handle auth callback without provider", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/auth?idToken=jwt123")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleAuthCallbackStub, "jwt123", null)
			})

			it("should return false when idToken is missing", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/auth?provider=google")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
			})
		})

		describe("Unknown path handling", () => {
			it("should return false for unknown paths", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/unknown?param=value")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})
		})

		describe("Error handling", () => {
			it("should catch and log errors from controller methods", async () => {
				handleOpenRouterCallbackStub.rejects(new Error("Controller error"))

				const result = await SharedUriHandler.handleUri("vscode://cline.cline/openrouter?code=test123")

				expect(result).to.be.false
			})

			it("should handle malformed URIs gracefully", async () => {
				const result = await SharedUriHandler.handleUri("invalid://uri")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})
		})

		describe("Query parameter parsing", () => {
			it("should correctly parse multiple query parameters", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/auth?idToken=jwt123&provider=github&extra=param",
				)

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleAuthCallbackStub, "jwt123", "github")
			})

			it("should handle URL-encoded parameters", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/auth?idToken=jwt%20with%20spaces&provider=google",
				)

				expect(result).to.be.true
				// URLSearchParams should decode %20 to spaces
				sinon.assert.calledOnceWithExactly(handleAuthCallbackStub, "jwt with spaces", "google")
			})

			it("should handle empty query string", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/openrouter")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})
		})

		describe("Different URI schemes", () => {
			it("should handle HTTP scheme URIs", async () => {
				const result = await SharedUriHandler.handleUri("http://localhost:3000/openrouter?code=test123")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test123")
			})

			it("should handle HTTPS scheme URIs", async () => {
				const result = await SharedUriHandler.handleUri("https://example.com/auth?idToken=jwt123&provider=github")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleAuthCallbackStub, "jwt123", "github")
			})
		})
	})
})
