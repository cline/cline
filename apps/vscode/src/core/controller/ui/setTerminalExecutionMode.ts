import { BooleanRequest, KeyValuePair } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Sets the terminal execution mode
 */
export async function setTerminalExecutionMode(_controller: Controller, _request: BooleanRequest): Promise<KeyValuePair> {
	return KeyValuePair.create({})
}
