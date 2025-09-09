import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as sinon from "sinon"
import { Controller } from ".."
import { IRecorder } from "./grpc-recorder"
import { GrpcRecorderBuilder } from "./grpc-recorder.builder"
import { testHooks } from "./test-hooks"
import { GrpcLogEntry } from "./types"

describe("test-hooks", () => {
	let cleanupSyntheticEntriesStub: sinon.SinonStub
	let recordRequestStub: sinon.SinonStub
	let recordResponseStub: sinon.SinonStub
	let getRecorderStub: sinon.SinonStub

	beforeEach(() => {
		cleanupSyntheticEntriesStub = sinon.stub()
		recordRequestStub = sinon.stub()
		recordResponseStub = sinon.stub()

		const mockRecorder: IRecorder = {
			cleanupSyntheticEntries: cleanupSyntheticEntriesStub,
			recordRequest: recordRequestStub,
			recordResponse: recordResponseStub,
			recordError: sinon.stub(),
			getSessionLog: sinon.stub().returns({ startTime: "", entries: [] }),
		}

		getRecorderStub = sinon.stub(GrpcRecorderBuilder, "getRecorder").returns(mockRecorder)
	})

	afterEach(() => {
		sinon.restore()
	})

	it("should return an array of post-record hooks", () => {
		const mockController = {} as Controller
		const hooks = testHooks(mockController)

		hooks.should.be.an.Array()
		hooks.should.have.length(1)
		hooks[0].should.be.a.Function()
	})

	it("should execute hook and call recorder methods", async () => {
		const mockController = {
			getStateToPostToWebview: sinon.stub().returns({}),
		} as any as Controller

		const hooks = testHooks(mockController)

		const mockEntry: GrpcLogEntry = {
			requestId: "test-request-id",
			service: "TestService",
			method: "testMethod",
			isStreaming: false,
			request: { message: {} },
			status: "pending",
		}

		await hooks[0](mockEntry)

		// Validate sinon stub calls
		sinon.assert.calledWith(getRecorderStub, mockController)
		sinon.assert.calledOnce(cleanupSyntheticEntriesStub)
		sinon.assert.calledOnce(recordRequestStub)
		sinon.assert.calledOnce(recordResponseStub)
	})
})
