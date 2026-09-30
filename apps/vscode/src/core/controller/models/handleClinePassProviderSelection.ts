import type { ApiConfiguration } from "@shared/api"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

export const CLINE_PASS_PROVIDER_ID = "cline-pass"

/**
 * ClinePass always uses the user's personal Cline account balance.
 *
 * The account switch is a network round-trip (plus a possible token refresh),
 * so it runs fire-and-forget: callers must not block the config update — or
 * the state post that re-renders the settings UI — on it. Auth state changes
 * propagate to the webview separately once the switch completes.
 *
 * The switch runs inside the cloud-session reset, like the Account view's
 * organization switch, so a displayed organization cloud task and its
 * authenticated connections are torn down before the account becomes Personal.
 *
 * This is intentionally best-effort: selecting the provider should still be
 * saved even if the account switch fails.
 */
export function clearOrganizationForClinePassProviderSelection(
	controller: Controller,
	apiConfiguration: Pick<ApiConfiguration, "planModeApiProvider" | "actModeApiProvider">,
): void {
	if (
		apiConfiguration.planModeApiProvider !== CLINE_PASS_PROVIDER_ID &&
		apiConfiguration.actModeApiProvider !== CLINE_PASS_PROVIDER_ID
	) {
		return
	}
	// Every API configuration update passes through here, and the reset clears
	// the displayed cloud task, so run it only when the account will change.
	if (!controller.authService.getActiveOrganizationId()) {
		return
	}

	controller
		.resetCloudSessions(() => controller.accountService.switchAccount(undefined))
		.catch((error) => {
			Logger.debug("Failed to switch ClinePass to personal account", { error })
		})
}
