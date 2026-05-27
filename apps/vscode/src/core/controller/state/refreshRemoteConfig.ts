import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { fetchRemoteConfig } from "@/core/storage/remote-config/fetch"
import { Controller } from ".."

/**
 * fetches the remote config
 * @param controller The controller instance
 * @param request Empty request
 * @returns Empty response
 */
export async function refreshRemoteConfig(controller: Controller, _: EmptyRequest): Promise<Empty> {
	await fetchRemoteConfig(controller)

	return Empty.create()
}
