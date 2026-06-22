import { Empty } from "@shared/proto/cline/common"
import type { ApiConfiguration } from "@shared/api"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { UpdateApiConfigurationRequestNew } from "@/shared/proto/index.cline"
import type { Controller } from "../index"

/**
 * Parses field-mask paths into separate sets for options and secrets.
 * Paths use dot notation, e.g. "options.ulid", "secrets.apiKey".
 */
function parseFieldMask(updateMask: string[]): { options: Set<string>; secrets: Set<string> } {
	const options = new Set<string>()
	const secrets = new Set<string>()
	for (const path of updateMask) {
		const [prefix, fieldName] = path.split(".", 2)
		if (prefix === "options" && fieldName) {
			options.add(fieldName)
		} else if (prefix === "secrets" && fieldName) {
			secrets.add(fieldName)
		} else {
			throw new Error(`Invalid field mask path: ${path}`)
		}
	}
	return { options, secrets }
}

/**
 * Updates API configuration using the new options/secrets request shape plus a
 * field mask. Masked option and secret fields are merged onto a partial
 * ApiConfiguration and persisted via the Controller. The two provider-enum
 * fields are converted from the proto enum to the application string union.
 */
export async function updateApiConfiguration(controller: Controller, request: UpdateApiConfigurationRequestNew): Promise<Empty> {
	const { updates, updateMask } = request

	if (!updates) {
		throw new Error("API configuration is required")
	}
	if (!updateMask || updateMask.length === 0) {
		throw new Error("Update mask is required and must contain at least one path")
	}

	const { options: maskOptions, secrets: maskSecrets } = parseFieldMask(updateMask)
	const merged: Partial<ApiConfiguration> = {}

	if (updates.options) {
		for (const [key, value] of Object.entries(updates.options)) {
			if (!maskOptions.has(key)) {
				continue
			}
			if (key === "planModeApiProvider" || key === "actModeApiProvider") {
				;(merged as Record<string, unknown>)[key] = convertProtoToApiProvider(value)
			} else {
				;(merged as Record<string, unknown>)[key] = value
			}
		}
	}

	if (updates.secrets) {
		for (const [key, value] of Object.entries(updates.secrets)) {
			if (maskSecrets.has(key)) {
				;(merged as Record<string, unknown>)[key] = value
			}
		}
	}

	await controller.updateApiConfiguration(merged)
	return Empty.create()
}
