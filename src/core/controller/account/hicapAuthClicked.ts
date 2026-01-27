import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { openExternal } from "@/utils/env"
import { Controller } from ".."

/**
 * Initiates Hicap auth
 */
export async function hicapAuthClicked(_: Controller, __: EmptyRequest): Promise<Empty> {
	const callbackUri = await HostProvider.get().getCallbackUrl()
	const authUri = `http://localhost:3000/setup?application=cline&callback_url=${callbackUri}/hicap`

	await openExternal(authUri)

	return {}
}
