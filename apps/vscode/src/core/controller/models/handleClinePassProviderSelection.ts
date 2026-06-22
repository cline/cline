import type { ApiConfiguration } from "@shared/api"
import type { Controller } from "../index"

export const CLINE_PASS_PROVIDER_ID = "cline-pass"

export async function clearOrganizationForClinePassProviderSelection(
	_controller: Controller,
	_apiConfiguration: Pick<ApiConfiguration, "planModeApiProvider" | "actModeApiProvider">,
): Promise<void> {
	return
}
