import { Empty, type EmptyRequest } from "@shared/proto/bedrock_coder/common"
import type { Controller } from "../index"

export async function cancelBedrockStartup(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	controller.bedrockStartup.cancel()
	return Empty.create()
}
