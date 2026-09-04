import { UserOrganizationUpdateRequest } from "@shared/proto/cline/account"
import { describe, expect, it, vi } from "vitest"
import { setUserOrganization } from "./setUserOrganization"

describe("setUserOrganization", () => {
	it("refreshes through the authoritative SDK path after switching organizations", async () => {
		const switchAccount = vi.fn().mockResolvedValue(undefined)
		const refreshRemoteConfig = vi.fn().mockResolvedValue(undefined)
		const resetCloudSessions = vi.fn(async (changeScope?: () => Promise<void>) => changeScope?.())
		const controller = {
			accountService: { switchAccount },
			refreshRemoteConfig,
			resetCloudSessions,
		}

		await setUserOrganization(controller as never, UserOrganizationUpdateRequest.create({ organizationId: "org-new" }))

		expect(switchAccount).toHaveBeenCalledWith("org-new")
		expect(refreshRemoteConfig).toHaveBeenCalledOnce()
		expect(resetCloudSessions.mock.invocationCallOrder[0]).toBeLessThan(switchAccount.mock.invocationCallOrder[0])
		expect(switchAccount.mock.invocationCallOrder[0]).toBeLessThan(refreshRemoteConfig.mock.invocationCallOrder[0])
	})
})
