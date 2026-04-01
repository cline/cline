import * as assert from "assert"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { AuthService } from "@/services/auth/AuthService"

describe("ClineAccountService.fetchFeaturebaseToken", () => {
	let service: ClineAccountService
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		sandbox.stub(AuthService, "getInstance").returns({} as AuthService)
		service = new ClineAccountService()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("returns featurebaseJwt on a successful authenticated request", async () => {
		sandbox
			.stub(service as unknown as { authenticatedRequest: () => unknown }, "authenticatedRequest")
			.resolves({ featurebaseJwt: "test-jwt-token-123" })

		const result = await service.fetchFeaturebaseToken()

		assert.ok(result !== undefined, "result should not be undefined")
		assert.strictEqual(result?.featurebaseJwt, "test-jwt-token-123")
	})

	it("returns undefined when the request throws a network error", async () => {
		sandbox
			.stub(service as unknown as { authenticatedRequest: () => unknown }, "authenticatedRequest")
			.rejects(new Error("Network error"))

		const result = await service.fetchFeaturebaseToken()

		assert.strictEqual(result, undefined)
	})

	it("returns undefined when the request throws due to missing auth token", async () => {
		sandbox
			.stub(service as unknown as { authenticatedRequest: () => unknown }, "authenticatedRequest")
			.rejects(new Error("No Cline account auth token found"))

		const result = await service.fetchFeaturebaseToken()

		assert.strictEqual(result, undefined)
	})
})
