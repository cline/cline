import { expect } from "chai"
import "should"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { GrpcRecorder } from "@/core/controller/grpc-recorder/grpc-recorder"
import { HostProvider } from "@/hosts/host-provider"
import { VscodeWebviewProvider } from "@/hosts/vscode/VscodeWebviewProvider"
import type { ExtensionMessage, GrpcResponse } from "@/shared/ExtensionMessage"
import type { GrpcRequest, WebviewMessage } from "@/shared/WebviewMessage"
import { WebviewProviderType } from "@/shared/webview/types"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"

const mockWebview = {
	postMessage: sinon.stub(),
	onDidReceiveMessage: sinon.stub(),
	html: "",
	options: {},
	cspSource: "vscode-webview://test",
	asWebviewUri: sinon.stub(),
}

const mockWebviewView = {
	webview: mockWebview,
	visible: true,
	onDidChangeVisibility: sinon.stub(),
	onDidDispose: sinon.stub(),
}

const mockContext = {
	extensionUri: vscode.Uri.file("/test/path"),
	extensionMode: vscode.ExtensionMode.Test,
	subscriptions: [],
	globalStorageUri: vscode.Uri.file("/test/global-storage"),
	globalState: {
		get: sinon.stub(),
		update: sinon.stub(),
		keys: sinon.stub().returns([]),
		setKeysForSync: sinon.stub(),
	},
	secrets: {
		get: sinon.stub(),
		store: sinon.stub(),
		delete: sinon.stub(),
		onDidChange: sinon.stub(),
	},
	workspaceState: {
		get: sinon.stub(),
		update: sinon.stub(),
		keys: sinon.stub().returns([]),
	},
	extension: {
		packageJSON: {
			version: "1.0.0-test",
		},
	},
} as any

describe("VscodeWebviewProvider Recording Middleware", () => {
	let provider: VscodeWebviewProvider
	let recorderStub: sinon.SinonStubbedInstance<any>
	let consoleWarnStub: sinon.SinonStub

	beforeEach(() => {
		recorderStub = {
			recordRequest: sinon.stub(),
			recordResponse: sinon.stub(),
			recordError: sinon.stub(),
			flushLog: sinon.stub(),
			getLogFilePath: sinon.stub(),
			getSessionLog: sinon.stub(),
		}
		const builderStub = {
			enableIf: sinon.stub().returnsThis(),
			withLogFileHandler: sinon.stub().returnsThis(),
			build: sinon.stub().returns(recorderStub),
		}

		sinon.stub(GrpcRecorder, "builder").returns(builderStub as any)

		consoleWarnStub = sinon.stub(console, "warn")

		setVscodeHostProviderMock()

		provider = new VscodeWebviewProvider(mockContext, WebviewProviderType.SIDEBAR)
		expect((provider as any).recorder).to.equal(recorderStub)

		mockWebview.postMessage.reset()
		mockWebview.onDidReceiveMessage.reset()
		mockWebviewView.onDidChangeVisibility.reset()
		mockWebviewView.onDidDispose.reset()
	})

	afterEach(() => {
		sinon.restore()
		HostProvider.reset()
	})

	describe("withRecordingMiddleware", () => {
		it("should record gRPC responses when middleware is applied", async () => {
			const mockPostMessage = sinon.stub().resolves(true)
			const grpcResponse: GrpcResponse = {
				request_id: "test-request-123",
				message: { test: "response" },
				error: undefined,
				is_streaming: false,
				sequence_number: 1,
			}
			const extensionMessage: ExtensionMessage = {
				type: "grpc_response",
				grpc_response: grpcResponse,
			}

			const middleware = (provider as any).withRecordingMiddleware(mockPostMessage)
			const result = await middleware(extensionMessage)

			expect(result).to.be.true
			sinon.assert.calledOnceWithExactly(recorderStub.recordResponse, "test-request-123", grpcResponse)
			sinon.assert.calledOnceWithExactly(mockPostMessage, extensionMessage)
		})

		it("should pass through non-gRPC messages without recording", async () => {
			const mockPostMessage = sinon.stub().resolves(true)
			const extensionMessage: ExtensionMessage = {
				type: "grpc_response" as any,
			}

			const middleware = (provider as any).withRecordingMiddleware(mockPostMessage)
			const result = await middleware(extensionMessage)

			expect(result).to.be.true
			sinon.assert.notCalled(recorderStub.recordResponse)
			sinon.assert.calledOnceWithExactly(mockPostMessage, extensionMessage)
		})

		it("should handle recording errors gracefully", async () => {
			const mockPostMessage = sinon.stub().resolves(true)
			const grpcResponse: GrpcResponse = {
				request_id: "test-request-123",
				message: { test: "response" },
				error: undefined,
				is_streaming: false,
				sequence_number: 1,
			}
			const extensionMessage: ExtensionMessage = {
				type: "grpc_response",
				grpc_response: grpcResponse,
			}

			const recordingError = new Error("Recording failed")
			recorderStub.recordResponse.throws(recordingError)

			const middleware = (provider as any).withRecordingMiddleware(mockPostMessage)
			const result = await middleware(extensionMessage)

			expect(result).to.be.true
			sinon.assert.calledOnceWithExactly(recorderStub.recordResponse, "test-request-123", grpcResponse)
			sinon.assert.calledOnceWithExactly(mockPostMessage, extensionMessage)
		})
	})

	describe("recordRequest", () => {
		it("should record gRPC requests successfully", () => {
			const grpcRequest: GrpcRequest = {
				request_id: "test-request-456",
				service: "TestService",
				method: "testMethod",
				message: { test: "request" },
				is_streaming: false,
			}

			;(provider as any).recordRequest(grpcRequest)

			sinon.assert.calledOnceWithExactly(recorderStub.recordRequest, grpcRequest)
		})

		it("should handle request recording errors gracefully", () => {
			const grpcRequest: GrpcRequest = {
				request_id: "test-request-456",
				service: "TestService",
				method: "testMethod",
				message: { test: "request" },
				is_streaming: false,
			}

			const recordingError = new Error("Request recording failed")
			recorderStub.recordRequest.throws(recordingError)

			expect(() => {
				;(provider as any).recordRequest(grpcRequest)
			}).to.not.throw()

			sinon.assert.calledOnceWithExactly(recorderStub.recordRequest, grpcRequest)
		})
	})

	describe("handleWebviewMessage integration", () => {
		it("should record requests and use middleware for responses in grpc_request flow", async () => {
			const grpcRequest: GrpcRequest = {
				request_id: "integration-test-789",
				service: "TestService",
				method: "testMethod",
				message: { test: "integration" },
				is_streaming: false,
			}

			const webviewMessage: WebviewMessage = {
				type: "grpc_request",
				grpc_request: grpcRequest,
			}

			const handleGrpcRequestStub = sinon.stub()
			const originalHandleGrpcRequest = require("@/core/controller/grpc-handler").handleGrpcRequest
			require("@/core/controller/grpc-handler").handleGrpcRequest = handleGrpcRequestStub

			await provider.resolveWebviewView(mockWebviewView as any)
			await provider.handleWebviewMessage(webviewMessage)

			sinon.assert.calledOnceWithExactly(recorderStub.recordRequest, grpcRequest)
			sinon.assert.calledOnce(handleGrpcRequestStub)

			const postMessageWithRecording = handleGrpcRequestStub.getCall(0).args[1]
			expect(postMessageWithRecording).to.be.a("function")

			require("@/core/controller/grpc-handler").handleGrpcRequest = originalHandleGrpcRequest
		})

		it("should handle unknown message types without recording", async () => {
			const webviewMessage: WebviewMessage = {
				type: "unknown_message_type" as any,
			}

			const consoleErrorStub = sinon.stub(console, "error")

			await provider.resolveWebviewView(mockWebviewView as any)
			await provider.handleWebviewMessage(webviewMessage)

			sinon.assert.notCalled(recorderStub.recordRequest)
			consoleErrorStub.restore()
		})
	})
})
