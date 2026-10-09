import { UserOrganizationUpdateRequest } from "@shared/proto/cline/account"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getUserOrganizations } from "./getUserOrganizations"
import { setUserOrganization } from "./setUserOrganization"

describe("setUserOrganization", () => {
	afterEach(() => vi.useRealTimers())

	it("returns an unconfirmed timeout while the switch keeps running", async () => {
		vi.useFakeTimers()
		let finish!: () => void
		const switchAccount = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve
				}),
		)
		const refreshRemoteConfig = vi.fn(async () => {})
		const controller = { accountService: { switchAccount }, refreshRemoteConfig }
		const request = UserOrganizationUpdateRequest.create({ organizationId: "org-new" })
		const first = expect(setUserOrganization(controller as never, request)).rejects.toThrow("not confirmed within 10 seconds")
		await vi.advanceTimersByTimeAsync(10_000)
		await first
		expect(refreshRemoteConfig).not.toHaveBeenCalled()
		finish()
		await vi.advanceTimersByTimeAsync(0)
		// The timed-out switch still finishes its work.
		expect(refreshRemoteConfig).toHaveBeenCalledOnce()
	})

	it("does not turn unavailable organizations into confirmed Personal", async () => {
		const fetchUserOrganizationsRPC = vi.fn().mockResolvedValue(undefined)
		const controller = { accountService: { fetchUserOrganizationsRPC } }
		await expect(getUserOrganizations(controller as never, {})).rejects.toThrow("Could not confirm")
		fetchUserOrganizationsRPC.mockResolvedValue([])
		await expect(getUserOrganizations(controller as never, {})).resolves.toEqual({ organizations: [] })
	})

	it("bounds confirmation even when obtaining credentials is stuck", async () => {
		vi.useFakeTimers()
		const controller = { accountService: { fetchUserOrganizationsRPC: () => new Promise(() => {}) } }
		const checking = expect(getUserOrganizations(controller as never, {})).rejects.toThrow("confirmation timed out")
		await vi.advanceTimersByTimeAsync(10_000)
		await checking
	})
	it("refreshes through the authoritative SDK path after switching organizations", async () => {
		const switchAccount = vi.fn().mockResolvedValue(undefined)
		const refreshRemoteConfig = vi.fn().mockResolvedValue(undefined)
		const controller = { accountService: { switchAccount }, refreshRemoteConfig }

		await setUserOrganization(controller as never, UserOrganizationUpdateRequest.create({ organizationId: "org-new" }))

		expect(switchAccount).toHaveBeenCalledWith("org-new")
		expect(refreshRemoteConfig).toHaveBeenCalledOnce()
		expect(switchAccount.mock.invocationCallOrder[0]).toBeLessThan(refreshRemoteConfig.mock.invocationCallOrder[0])
	})
})
