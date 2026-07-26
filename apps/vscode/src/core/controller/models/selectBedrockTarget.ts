import { Empty } from "@shared/proto/cline/common"
import type { BedrockTargetSelectionRequest } from "@shared/proto/cline/models"
import type { Controller } from "../index"

export async function selectBedrockTarget(controller: Controller, request: BedrockTargetSelectionRequest): Promise<Empty> {
	if (request.kind !== "foundation-model" && request.kind !== "inference-profile") {
		throw new Error("A valid Bedrock target kind is required.")
	}
	if (!request.invocationId.trim()) throw new Error("A Bedrock invocation ID is required.")
	void controller.bedrockStartup.selectTarget(request.kind, request.invocationId)
	return Empty.create()
}
