import { Empty, type EmptyRequest } from "@shared/proto/bedrock_coder/common"
import type { Controller } from "../index"

export async function retryBedrockStartup(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	void controller.bedrockStartup.retry()
	return Empty.create()
}
