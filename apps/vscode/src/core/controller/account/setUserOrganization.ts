import { UserOrganizationUpdateRequest } from "@shared/proto/cline/account"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

const SWITCH_TIMEOUT_MS = 10_000

/**
 * Handles setting the user's active organization
 * @param controller The controller instance
 * @param request UserOrganization to set as active
 * @returns Empty response
 */
export async function setUserOrganization(controller: Controller, request: UserOrganizationUpdateRequest): Promise<Empty> {
	if (!controller.accountService) throw new Error("Account service not available")
	// switchAccount serialises switches and tears down the previous account's
	// cloud state itself. The response deadline below does not release that
	// ownership: a timed-out PUT may still commit, and a later switch waits for
	// it before deciding what to do.
	const switching = controller.accountService.switchAccount(request.organizationId).then(() => controller.refreshRemoteConfig())
	switching.catch(() => {})
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			switching,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error(
								"Account switch was not confirmed within 10 seconds and may still finish. Check Account before starting another task.",
							),
						),
					SWITCH_TIMEOUT_MS,
				)
			}),
		])
		return {}
	} finally {
		clearTimeout(timer)
	}
}
