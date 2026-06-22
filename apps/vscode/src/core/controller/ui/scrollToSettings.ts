import { KeyValuePair, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Executes a scroll to settings action
 */
export async function scrollToSettings(_controller: Controller, _request: StringRequest): Promise<KeyValuePair> {
	return KeyValuePair.create({})
}
