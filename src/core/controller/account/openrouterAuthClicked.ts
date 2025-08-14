import { HostProvider } from "@/hosts/host-provider"
import { openExternal } from "@/utils/env"

import { Controller } from ".."
import { EmptyRequest, Empty } from "@shared/proto/cline/common"

/**
 * Initiates OpenRouter auth
 */
export async function openrouterAuthClicked(_: Controller, __: EmptyRequest): Promise<Empty> {
	const callbackUri = await HostProvider.get().getCallbackUri()
	const authUri = `https://openrouter.ai/auth?callback_url=${callbackUri}/openrouter`

	await openExternal(authUri)

	return {}
}
