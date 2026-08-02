import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { Controller } from "../index"

/**
 * Keeps LM Studio credentials synchronized across legacy state and the SDK
 * provider store, whose change event rebuilds an active provider session.
 */
export function writeLmStudioApiKey(controller: Controller, apiKey: string | undefined): void {
	controller.getProviderConfigStore().write(parseProviderId("lmstudio"), { apiKey })
}
