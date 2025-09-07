import { GrpcAdapter } from "@adapters/grpcAdapter"
import { expect } from "chai"
import sinon from "sinon"

describe("GrpcAdapter", () => {
	const address = "localhost:50051"
	let adapter: GrpcAdapter
	let fakeClient: any

	beforeEach(() => {
		adapter = new GrpcAdapter(address)
		fakeClient = {
			testMethod: sinon.stub().yields(null, { toObject: () => ({ foo: "bar" }) }),
			close: sinon.stub(),
		}
		adapter["clients"]["cline.TestService"] = fakeClient
	})

	afterEach(() => sinon.restore())

	it("should call a service method and return response", async () => {
		const res = await adapter.call("cline.TestService", "testMethod", { message: {} })
		expect(res).to.deep.equal({ foo: "bar" })
		expect(fakeClient.testMethod.calledOnce).to.be.true
	})

	it("should throw error if service not found", async () => {
		try {
			await adapter.call("cline.UnknownService", "testMethod", { message: {} })
			throw new Error("Expected error not thrown")
		} catch (err: any) {
			expect(err.message).to.match(/No gRPC client registered/)
		}
	})

	it("should close all clients when close() is called", () => {
		adapter.close()
		expect(fakeClient.close.calledOnce).to.be.true
	})
})
