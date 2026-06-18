import type { ApiConfiguration } from "@shared/api";
import { Logger } from "@/shared/services/Logger";
import type { Controller } from "../index";

const CLINE_PASS_PROVIDER_ID = "cline-pass";

/**
 * Cline Pass always uses the user's personal Cline account balance.
 *
 * This is intentionally best-effort: selecting the provider should still be
 * saved even if the account switch fails.
 */
export async function clearOrganizationForClinePassProviderSelection(
	controller: Controller,
	apiConfiguration: Pick<
		ApiConfiguration,
		"planModeApiProvider" | "actModeApiProvider"
	>,
): Promise<void> {
	if (
		apiConfiguration.planModeApiProvider !== CLINE_PASS_PROVIDER_ID &&
		apiConfiguration.actModeApiProvider !== CLINE_PASS_PROVIDER_ID
	) {
		return;
	}

	try {
		await controller.accountService.switchAccount(null);
	} catch (error) {
		Logger.debug("Failed to switch Cline Pass to personal account", { error });
	}
}
