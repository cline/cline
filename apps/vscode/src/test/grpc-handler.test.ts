import { expect } from "chai"
import "should"
import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import * as actualProtobusServices from "@generated/hosts/vscode/protobus-services"
import * as sinon from "sinon"
import { Controller } from "@/core/controller"
import { GrpcRecorder } from "@/core/controller/grpc-recorder/grpc-recorder"
import type { ExtensionMessage } from "@/shared/ExtensionMessage"
import type { GrpcRequest } from "@/shared/WebviewMessage"

// bun loads real ESM, so sinon cannot replace the `serviceHandlers` namespace
// binding ("Cannot replace module namespace object's binding's value"). Route it
// through a STABLE object reference installed via mock.module; the SUT reads
// `serviceHandlers[serviceName]` at call time, so each test mutates the contents
// of this same object (clearing then assigning) rather than swapping the binding.
const currentServiceHandlers: Record<string, unknown> = {}
mock.module("@generated/hosts/vscode/protobus-services", () => ({
	...actualProtobusServices,
	serviceHandlers: currentServiceHandlers,
}))

import { handleGrpcRequest } from "@/core/controller/grpc-handler"

describe("GrpcHandler Recording Middleware", () => {
	let recorderStub: sinon.SinonStubbedInstance<any>
	let builderStub: any
	let consoleWarnStub: sinon.SinonStub
	let mockController: sinon.SinonStubbedInstance<Controller>
	let mockPostMessage: sinon.SinonStub

	beforeEach(() => {
		recorderStub = {
			recordRequest: sinon.stub(),
			recordResponse: sinon.stub(),
			recordError: sinon.stub(),
			getSessionLog: sinon.stub(),
		}

		builderStub = {
			enableIf: sinon.stub().returnsThis(),
			withLogFileHandler: sinon.stub().returnsThis(),
			build: sinon.stub().returns(recorderStub),
		}

		sinon.stub(GrpcRecorder, "builder").returns(builderStub)
		consoleWarnStub = sinon.stub(console, "warn")
		mockController = sinon.createStubInstance(Controller)
		mockPostMessage = sinon.stub().resolves(true)

		const mockServiceHandlers = {
			TestService: {
				testMethod: sinon.stub().resolves({ success: true }),
				errorMethod: sinon.stub().rejects(new Error("Simulated failure")),
			},
		}

		for (const key of Object.keys(currentServiceHandlers)) {
			delete currentServiceHandlers[key]
		}
		Object.assign(currentServiceHandlers, mockServiceHandlers)
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("Recording Middleware Integration", () => {
		it("should record requests and responses for unary gRPC calls", async () => {
			const grpcRequest: GrpcRequest = {
				request_id: "the-request-id",
				service: "TestService",
				method: "testMethod",
				message: { test: "request" },
				is_streaming: false,
			}

			await handleGrpcRequest(mockController, mockPostMessage, grpcRequest)

			expect(recorderStub.recordRequest.calledOnceWithExactly(grpcRequest)).to.be.true
			expect(recorderStub.recordError.notCalled).to.be.true

			expect(mockPostMessage.calledOnce).to.be.true
			const sentMessage = mockPostMessage.getCall(0).args[0] as ExtensionMessage
			expect(sentMessage.type).to.equal("grpc_response")
			expect(sentMessage.grpc_response?.request_id).to.equal("the-request-id")
			expect(sentMessage.grpc_response?.message).to.deep.equal({ success: true })

			expect(recorderStub.recordResponse.calledOnceWithExactly("the-request-id", sentMessage.grpc_response)).to.be.true
		})
	})
})
