import { beforeEach, describe, expect, it, vi } from "vitest"
import { getUserOrganizations } from "@/core/controller/account/getUserOrganizations"
import { ClineAccountService } from "./account-service"

const mocks = vi.hoisted(() => ({ request: vi.fn(), restore: vi.fn() }))
vi.mock("axios", () => ({ default: { request: mocks.request } }))
vi.mock("./auth-service", () => ({
	AuthService: {
		getInstance: () => ({
			getAuthToken: async () => "fixture-token",
			getActiveOrganizationId: () => "org-old",
			restoreRefreshTokenAndRetrieveAuthInfo: mocks.restore,
		}),
	},
}))
vi.mock("@/config", () => ({ ClineEnv: { config: () => ({ apiBaseUrl: "http://127.0.0.1:1" }) } }))
vi.mock("@/services/EnvUtils", () => ({ buildBasicClineHeaders: async () => ({}) }))
vi.mock("@/shared/net", () => ({ getAxiosSettings: () => ({}) }))

describe("account confirmation", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.restore.mockResolvedValue(undefined)
	})
	it("propagates an unavailable profile through the real service and RPC handler", async () => {
		mocks.request.mockRejectedValue(new Error("offline"))
		const controller = { accountService: new ClineAccountService() }
		await expect(getUserOrganizations(controller as never, {})).rejects.toThrow("Could not confirm")
		expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ timeout: 10_000, method: "GET" }))
	})
	it("bounds the mutation request and reconciles auth after a transport failure", async () => {
		mocks.request.mockRejectedValue(new Error("timeout"))
		await expect(new ClineAccountService().switchAccount("org-new")).rejects.toThrow("timeout")
		expect(mocks.request).toHaveBeenCalledWith(
			expect.objectContaining({ timeout: 10_000, method: "PUT", data: { organizationId: "org-new" } }),
		)
		expect(mocks.restore).toHaveBeenCalledOnce()
	})
})
