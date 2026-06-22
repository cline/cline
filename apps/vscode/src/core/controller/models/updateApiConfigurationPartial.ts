import type { ApiConfiguration } from "@shared/api"
import { Empty } from "@shared/proto/cline/common"
import { UpdateApiConfigurationPartialRequest } from "@shared/proto/cline/models"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import type { Controller } from "../index"

/**
 * Updates API configuration with partial values using a field mask. The proto
 * ApiConfiguration is converted to the application shape, then only the
 * top-level fields named in the mask are applied and persisted via the
 * Controller.
 */
export async function updateApiConfigurationPartial(
	controller: Controller,
	request: UpdateApiConfigurationPartialRequest,
): Promise<Empty> {
	if (!request.updateMask || request.updateMask.length === 0) {
		throw new Error("update_mask is required and must contain at least one field")
	}
	if (!request.apiConfiguration) {
		throw new Error("api_configuration is required")
	}

	const newValues = convertProtoToApiConfiguration(request.apiConfiguration) as Record<string, unknown>
	const updates: Partial<ApiConfiguration> = {}
	for (const field of request.updateMask) {
		;(updates as Record<string, unknown>)[field] = newValues[field]
	}

	await controller.updateApiConfiguration(updates)
	return Empty.create()
}
