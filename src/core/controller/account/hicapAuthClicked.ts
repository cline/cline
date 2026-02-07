import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { openExternal } from "@/utils/env"
import { Controller } from ".."

/**
 * Initiates Hicap auth
 */
export async function hicapAuthClicked(_: Controller, __: EmptyRequest): Promise<Empty> {
	const callbackUrl = await HostProvider.get().getCallbackUrl("/hicap")
	const authUrl = `https://dashboard.hicap.ai/setup?application=cline&callback_url=${callbackUrl}`

	await openExternal(authUrl)

	return {}
}
