import { Empty, StringRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { toRequestyServiceUrl } from "@/shared/clients/requesty"
import { openExternal } from "@/utils/env"
import { Controller } from ".."

/**
 * Initiates Requesty auth with optional custom base URL
 */
export async function requestyAuthClicked(_: Controller, req: StringRequest): Promise<Empty> {
	const customBaseUrl = req.value || undefined
	const callbackUrl = await HostProvider.get().getCallbackUrl()
	const baseUrl = toRequestyServiceUrl(customBaseUrl, "app")

	if (!baseUrl) {
		throw new Error("Invalid Requesty base URL")
	}

	const authUrl = new URL(`oauth/authorize?callback_url=${callbackUrl}/requesty`, baseUrl)

	await openExternal(authUrl.toString())

	return {}
}
