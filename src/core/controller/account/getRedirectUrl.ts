import { EmptyRequest, String } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { Controller } from "../index"

/**
 * Constructs and returns a URL that will redirect to the user's IDE.
 */
export async function getRedirectUrl(_controller: Controller, _: EmptyRequest): Promise<String> {
	const url = (await HostProvider.env.getIdeRedirectUri({})).value
	return { value: url }
}
