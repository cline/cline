import { UserOrganizationUpdateRequest } from "@shared/proto/cline/account"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

const pendingSwitches = new WeakMap<Controller, Promise<void>>()
const SWITCH_TIMEOUT_MS = 10_000

/**
 * Handles setting the user's active organization
 * @param controller The controller instance
 * @param request UserOrganization to set as active
 * @returns Empty response
 */
export async function setUserOrganization(controller: Controller, request: UserOrganizationUpdateRequest): Promise<Empty> {
	if (pendingSwitches.has(controller)) {
		throw new Error("An account switch is still pending. Wait for it to finish before trying again.")
	}
	if (!controller.accountService) throw new Error("Account service not available")
	// The response deadline does not release ownership: a timed-out PUT may
	// still commit, so no second switch can overtake its auth/config refresh.
	const switching = Promise.resolve().then(async () => {
		await controller.resetCloudSessions(() => controller.accountService!.switchAccount(request.organizationId))
		await controller.refreshRemoteConfig()
	})
	pendingSwitches.set(controller, switching)
	void switching
		.finally(() => {
			if (pendingSwitches.get(controller) === switching) pendingSwitches.delete(controller)
		})
		.catch(() => {})
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
