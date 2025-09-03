import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import "should"
import * as vscode from "vscode"
import { GrpcRecorder } from "@/core/controller/grpc-recorder/grpc-recorder"
import { VscodeWebviewProvider } from "@/hosts/vscode/VscodeWebviewProvider"
import type { ExtensionMessage, GrpcResponse } from "@/shared/ExtensionMessage"
import type { GrpcRequest, WebviewMessage } from "@/shared/WebviewMessage"
import { WebviewProviderType } from "@/shared/webview/types"

// Mock VSCode API
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
} as any

describe("VscodeWebviewProvider Recording Middleware", () => {
	let provider: VscodeWebviewProvider
	let recorderStub: sinon.SinonStubbedInstance<any>
	let consoleWarnStub: sinon.SinonStub

	beforeEach(() => {
		// Create recorder stub
		recorderStub = {
			recordRequest: sinon.stub(),
			recordResponse: sinon.stub(),
			recordError: sinon.stub(),
			flushLog: sinon.stub(),
			getLogFilePath: sinon.stub(),
			getSessionLog: sinon.stub(),
		}

		// Stub GrpcRecorder.getInstance to return our mock
		sinon.stub(GrpcRecorder, "getInstance").returns(recorderStub)

		// Stub console.warn to capture warning messages
		consoleWarnStub = sinon.stub(console, "warn")

		// Create provider instance
		provider = new VscodeWebviewProvider(mockContext, WebviewProviderType.SIDEBAR)

		// Reset all stubs
		mockWebview.postMessage.reset()
		mockWebview.onDidReceiveMessage.reset()
		mockWebviewView.onDidChangeVisibility.reset()
		mockWebviewView.onDidDispose.reset()
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("withRecordingMiddleware", () => {
		it.skip("should record gRPC responses when middleware is applied", async () => {
			// Arrange
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

			// Get the middleware wrapper by accessing the private method
			const middleware = (provider as any).withRecordingMiddleware(mockPostMessage)

			// Act
			const result = await middleware(extensionMessage)

			// Assert
			result.should.equal(true)
			sinon.assert.calledOnceWithExactly(recorderStub.recordResponse, "test-request-123", grpcResponse)
			sinon.assert.calledOnceWithExactly(mockPostMessage, extensionMessage)
		})

		it.skip("should pass through non-gRPC messages without recording", async () => {
			// Arrange
			const mockPostMessage = sinon.stub().resolves(true)
			const extensionMessage: ExtensionMessage = {
				type: "grpc_response" as any, // Use any to bypass type checking for test
			}

			// Get the middleware wrapper
			const middleware = (provider as any).withRecordingMiddleware(mockPostMessage)

			// Act
			const result = await middleware(extensionMessage)

			// Assert
			result.should.equal(true)
			sinon.assert.notCalled(recorderStub.recordResponse)
			sinon.assert.calledOnceWithExactly(mockPostMessage, extensionMessage)
		})

		it.skip("should handle recording errors gracefully", async () => {
			// Arrange
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

			// Make recordResponse throw an error
			const recordingError = new Error("Recording failed")
			recorderStub.recordResponse.throws(recordingError)

			// Get the middleware wrapper
			const middleware = (provider as any).withRecordingMiddleware(mockPostMessage)

			// Act
			const result = await middleware(extensionMessage)

			// Assert
			result.should.equal(true)
			sinon.assert.calledOnceWithExactly(recorderStub.recordResponse, "test-request-123", grpcResponse)
			sinon.assert.calledOnceWithExactly(mockPostMessage, extensionMessage)
			sinon.assert.calledWith(consoleWarnStub, "Failed to record gRPC response:", recordingError)
		})
	})

	describe.skip("recordRequest", () => {
		it("should record gRPC requests successfully", () => {
			// Arrange
			const grpcRequest: GrpcRequest = {
				request_id: "test-request-456",
				service: "TestService",
				method: "testMethod",
				message: { test: "request" },
				is_streaming: false,
			}

			// Act
			;(provider as any).recordRequest(grpcRequest)

			// Assert
			sinon.assert.calledOnceWithExactly(recorderStub.recordRequest, grpcRequest)
		})

		it("should handle request recording errors gracefully", () => {
			// Arrange
			const grpcRequest: GrpcRequest = {
				request_id: "test-request-456",
				service: "TestService",
				method: "testMethod",
				message: { test: "request" },
				is_streaming: false,
			}

			// Make recordRequest throw an error
			const recordingError = new Error("Request recording failed")
			recorderStub.recordRequest.throws(recordingError)

			// Act
			;(provider as any).recordRequest(grpcRequest)

			// Assert
			sinon.assert.calledOnceWithExactly(recorderStub.recordRequest, grpcRequest)
			sinon.assert.calledWith(consoleWarnStub, "Failed to record gRPC request:", recordingError)
		})
	})

	describe.skip("handleWebviewMessage integration", () => {
		it("should record requests and use middleware for responses in grpc_request flow", async () => {
			// Arrange
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

			// Mock the handleGrpcRequest function to avoid actual gRPC handling
			const handleGrpcRequestStub = sinon.stub()
			const originalHandleGrpcRequest = require("@/core/controller/grpc-handler").handleGrpcRequest
			require("@/core/controller/grpc-handler").handleGrpcRequest = handleGrpcRequestStub

			// Set up the webview to simulate being resolved
			await provider.resolveWebviewView(mockWebviewView as any)

			// Act
			await provider.handleWebviewMessage(webviewMessage)

			// Assert
			sinon.assert.calledOnceWithExactly(recorderStub.recordRequest, grpcRequest)
			sinon.assert.calledOnce(handleGrpcRequestStub)

			// Verify that the postMessage function passed to handleGrpcRequest has middleware applied
			const postMessageWithRecording = handleGrpcRequestStub.getCall(0).args[1]
			postMessageWithRecording.should.be.a("function")

			// Restore original function
			require("@/core/controller/grpc-handler").handleGrpcRequest = originalHandleGrpcRequest
		})

		it("should handle unknown message types without recording", async () => {
			// Arrange
			const webviewMessage: WebviewMessage = {
				type: "unknown_message_type" as any,
			}

			// Stub console.error to capture error messages
			const consoleErrorStub = sinon.stub(console, "error")

			// Set up the webview
			await provider.resolveWebviewView(mockWebviewView as any)

			// Act
			await provider.handleWebviewMessage(webviewMessage)

			// Assert
			sinon.assert.notCalled(recorderStub.recordRequest)
			sinon.assert.calledWith(consoleErrorStub, "Received unhandled WebviewMessage type:", JSON.stringify(webviewMessage))

			consoleErrorStub.restore()
		})
	})

	describe.skip("middleware transparency", () => {
		it("should not affect message flow when recording is disabled", async () => {
			// Arrange - Create a no-op recorder
			const noopRecorder = {
				recordRequest: sinon.stub(),
				recordResponse: sinon.stub(),
				recordError: sinon.stub(),
				flushLog: sinon.stub(),
				getLogFilePath: sinon.stub(),
				getSessionLog: sinon.stub(),
			}

			// Replace the recorder with no-op version
			const getInstanceStub = sinon.stub(GrpcRecorder, "getInstance")
			getInstanceStub.restore()
			sinon.stub(GrpcRecorder, "getInstance").returns(noopRecorder)

			const mockPostMessage = sinon.stub().resolves(true)
			const extensionMessage: ExtensionMessage = {
				type: "grpc_response",
				grpc_response: {
					request_id: "test-123",
					message: { test: "data" },
					error: undefined,
					is_streaming: false,
					sequence_number: 1,
				},
			}

			// Get fresh middleware instance
			const middleware = (provider as any).withRecordingMiddleware(mockPostMessage)

			// Act
			const result = await middleware(extensionMessage)

			// Assert
			result.should.equal(true)
			sinon.assert.calledOnceWithExactly(mockPostMessage, extensionMessage)
			sinon.assert.calledOnce(noopRecorder.recordResponse)
		})
	})
})
