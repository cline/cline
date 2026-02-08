import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { openExternal } from "@/utils/env"
import { Controller } from ".."

/**
 * Initiates OpenRouter auth
 */
export async function openrouterAuthClicked(_: Controller, __: EmptyRequest): Promise<Empty> {
	const callbackUrl = await HostProvider.get().getCallbackUrl("/openrouter")
	const authUrl = `https://openrouter.ai/auth?callback_url=${callbackUrl}`

	await openExternal(authUrl)

	return {}
}
