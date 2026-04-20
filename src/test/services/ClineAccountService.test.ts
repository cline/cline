import * as assert from "assert"
import axios from "axios"
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

describe("ClineAccountService.fetchOverbudgetStatusRPC", () => {
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

	const buildAxiosError = (status: number): Error => {
		const err = new Error(`Request failed with status code ${status}`) as Error & {
			isAxiosError: boolean
			response: { status: number }
		}
		err.isAxiosError = true
		err.response = { status }
		return err
	}

	it("returns the overbudget status on a successful authenticated request", async () => {
		const payload = {
			overbudget: true,
			limits: { monthlyLimitUsd: 500, dailyLimitUsd: 50, orgMonthlyUsd: 5000, source: "org_default" },
			usage: { monthlySpendUsd: 0, dailySpendUsd: 0 },
		}
		sandbox.stub(service as unknown as { authenticatedRequest: () => unknown }, "authenticatedRequest").resolves(payload)

		const result = await service.fetchOverbudgetStatusRPC("org-123")

		assert.deepStrictEqual(result, payload)
	})

	it("returns undefined when the backend responds with 403 (feature not enabled)", async () => {
		sandbox.stub(axios, "isAxiosError").returns(true)
		sandbox
			.stub(service as unknown as { authenticatedRequest: () => unknown }, "authenticatedRequest")
			.rejects(buildAxiosError(403))

		const result = await service.fetchOverbudgetStatusRPC("org-123")

		assert.strictEqual(result, undefined)
	})

	it("returns undefined when the backend responds with 404 (feature not enabled)", async () => {
		sandbox.stub(axios, "isAxiosError").returns(true)
		sandbox
			.stub(service as unknown as { authenticatedRequest: () => unknown }, "authenticatedRequest")
			.rejects(buildAxiosError(404))

		const result = await service.fetchOverbudgetStatusRPC("org-123")

		assert.strictEqual(result, undefined)
	})

	it("returns undefined on transient network failure without throwing", async () => {
		sandbox
			.stub(service as unknown as { authenticatedRequest: () => unknown }, "authenticatedRequest")
			.rejects(new Error("Network error"))

		const result = await service.fetchOverbudgetStatusRPC("org-123")

		assert.strictEqual(result, undefined)
	})
})
