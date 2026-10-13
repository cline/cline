import { beforeEach, describe, expect, it, vi } from "vitest"
import { getUserOrganizations } from "@/core/controller/account/getUserOrganizations"
import { ClineAccountService } from "./account-service"

const mocks = vi.hoisted(() => ({ request: vi.fn(), restore: vi.fn(), activeOrganizationId: "org-old" as string | undefined }))
vi.mock("axios", () => ({ default: { request: mocks.request } }))
vi.mock("./auth-service", () => ({
	AuthService: {
		getInstance: () => ({
			getAuthToken: async () => "fixture-token",
			getActiveOrganizationId: () => mocks.activeOrganizationId,
			restoreRefreshTokenAndRetrieveAuthInfo: mocks.restore,
		}),
	},
}))

function deferred<T = void>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}
vi.mock("@/config", () => ({ ClineEnv: { config: () => ({ apiBaseUrl: "http://127.0.0.1:1" }) } }))
vi.mock("@/services/EnvUtils", () => ({ buildBasicClineHeaders: async () => ({}) }))
vi.mock("@/shared/net", () => ({ getAxiosSettings: () => ({}) }))

describe("switchAccount owns the account boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.restore.mockResolvedValue(undefined)
		mocks.activeOrganizationId = "org-old"
	})

	it("runs the account request inside the installed boundary", async () => {
		const order: string[] = []
		mocks.request.mockImplementation(async () => {
			order.push("request")
			return { status: 200, data: { success: true, data: "" } }
		})
		const service = new ClineAccountService()
		service.onAccountChange(async (change) => {
			order.push("teardown")
			await change()
			order.push("reopen")
		})

		await service.switchAccount("org-new")

		expect(order).toEqual(["teardown", "request", "reopen"])
	})

	it("serialises overlapping switches and re-checks the target once the pending one settles", async () => {
		// The first switch is in flight; the second must not observe the cached
		// account and decide it has nothing to do.
		const firstRequest = deferred<{ status: number; data: { success: boolean; data: string } }>()
		mocks.request
			.mockImplementationOnce(() => firstRequest.promise)
			.mockImplementation(async () => ({ status: 200, data: { success: true, data: "" } }))
		mocks.restore.mockImplementation(async () => {
			mocks.activeOrganizationId = "org-new"
		})
		const service = new ClineAccountService()

		const first = service.switchAccount("org-new")
		const second = service.switchAccount(undefined)
		await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1))

		firstRequest.resolve({ status: 200, data: { success: true, data: "" } })
		await Promise.all([first, second])

		expect(mocks.request).toHaveBeenCalledTimes(2)
		expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ data: { organizationId: null } }))
	})

	it("restores the server account without tearing down cloud state when the cached account already matches", async () => {
		// Another client on the same login may have moved the server's active
		// account; the request must still be sent, but the cloud state here is
		// scoped by the cached account, which is not changing.
		mocks.request.mockResolvedValue({ status: 200, data: { success: true, data: "" } })
		const boundary = vi.fn(async (change: () => Promise<void>) => change())
		const service = new ClineAccountService()
		service.onAccountChange(boundary)

		await service.switchAccount("org-old")

		expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ data: { organizationId: "org-old" } }))
		expect(boundary).not.toHaveBeenCalled()
	})
})

describe("account confirmation", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.restore.mockResolvedValue(undefined)
		mocks.activeOrganizationId = "org-old"
	})
	it("propagates an unavailable profile through the real service and RPC handler", async () => {
		mocks.request.mockRejectedValue(new Error("offline"))
		const controller = { accountService: new ClineAccountService() }
		await expect(getUserOrganizations(controller as never, {})).rejects.toThrow("Could not confirm")
		expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ timeout: 10_000, method: "GET" }))
	})
	it("waits for the server's answer to the mutation and reconciles auth after a transport failure", async () => {
		mocks.request.mockRejectedValue(new Error("offline"))
		await expect(new ClineAccountService().switchAccount("org-new")).rejects.toThrow("offline")
		expect(mocks.request).toHaveBeenCalledWith(
			expect.objectContaining({ timeout: 0, method: "PUT", data: { organizationId: "org-new" } }),
		)
		expect(mocks.restore).toHaveBeenCalledOnce()
	})
})
