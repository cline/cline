import { Empty } from "@shared/proto/cline/common"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { buildApiHandler } from "@/core/api"
import { ApiHandlerOptions, ApiHandlerSecrets, ApiProvider } from "@/shared/api"
import { UpdateApiConfigurationRequestNew } from "@/shared/proto/index.cline"
import type { Controller } from "../index"

/**
 * Parses field mask paths into separate sets for options and secrets
 * @param updateMask Array of field mask paths (e.g., ["options.ulid", "options.openAiHeaders", "secrets.apiKey"])
 * @returns Object with options and secrets field name sets
 */
function parseFieldMask(updateMask: string[]): {
	options: Set<string>
	secrets: Set<string>
} {
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
 * Gets the alternate mode field name (e.g., planModeX <-> actModeX)
 * @param fieldName The field name to get alternate for
 * @returns The alternate mode field name or null if not a mode-specific field
 */
function getAlternateModeField(fieldName: string): string | null {
	if (fieldName.startsWith("planMode")) {
		return fieldName.replace("planMode", "actMode")
	} else if (fieldName.startsWith("actMode")) {
		return fieldName.replace("actMode", "planMode")
	}
	return null
}

/**
 * Updates API configuration using field mask
 * @param controller The controller instance
 * @param request The update API configuration request with field mask
 * @returns Empty response
 */
export async function updateApiConfiguration(controller: Controller, request: UpdateApiConfigurationRequestNew): Promise<Empty> {
	try {
		const { updates, updateMask } = request

		if (!updates) {
			throw new Error("API configuration is required")
		}

		if (!updateMask || updateMask.length === 0) {
			throw new Error("Update mask is required and must contain at least one path")
		}

		const { options: protoOptions, secrets: protoSecrets } = updates

		// Parse the field mask to determine which fields to update
		const { options: maskOptionsFields, secrets: maskSecretsFields } = parseFieldMask(updateMask)

		// Process secrets based on field mask
		const secrets: Partial<ApiHandlerSecrets> = {}

		if (protoSecrets && maskSecretsFields.size > 0) {
			// Validate all masked fields exist
			for (const fieldName of maskSecretsFields) {
				if (!(fieldName in protoSecrets)) {
					throw new Error(`Field "${fieldName}" specified in mask but not found in secrets`)
				}
			}
			// Process entries that are in the mask
			for (const [key, value] of Object.entries(protoSecrets)) {
				if (maskSecretsFields.has(key)) {
					secrets[key as keyof ApiHandlerSecrets] = value
				}
			}
		}

		// Process options based on field mask
		const options: Partial<ApiHandlerOptions> & { planModeApiProvider?: ApiProvider; actModeApiProvider?: ApiProvider } = {}
		if (protoOptions && maskOptionsFields.size > 0) {
			// Validate all masked fields exist
			for (const fieldName of maskOptionsFields) {
				if (!(fieldName in protoOptions)) {
					throw new Error(`Field "${fieldName}" specified in mask but not found in options`)
				}
			}

			// Check if mode-specific configurations should be kept separate
			const separateModeConfigs = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")

			// Process entries that are in the mask
			for (const [key, value] of Object.entries(protoOptions)) {
				if (maskOptionsFields.has(key)) {
					// Handle enum conversions
					if (key === "planModeApiProvider") {
						options.planModeApiProvider = convertProtoToApiProvider(value)
					} else if (key === "actModeApiProvider") {
						options.actModeApiProvider = convertProtoToApiProvider(value)
					} else {
						options[key as keyof ApiHandlerOptions] = value
					}

					// If mode configs should be synced, also update the alternate mode field
					if (!separateModeConfigs) {
						const alternateField = getAlternateModeField(key)
						if (alternateField) {
							if (alternateField === "planModeApiProvider") {
								options.planModeApiProvider = convertProtoToApiProvider(value)
							} else if (alternateField === "actModeApiProvider") {
								options.actModeApiProvider = convertProtoToApiProvider(value)
							} else {
								options[alternateField as keyof ApiHandlerOptions] = value
							}
						}
					}
				}
			}
		}

		// Update storage using batch methods
		if (Object.keys(secrets).length > 0) {
			controller.stateManager.setSecretsBatch(secrets)
		}
		if (Object.keys(options).length > 0) {
			controller.stateManager.setGlobalStateBatch(options)
		}

		// Update the task's API handler if there's an active task
		if (controller.task) {
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
			// Combine secrets and options for the API handler
			const apiConfigForHandler = { ...secrets, ...options, ulid: controller.task.ulid }
			controller.task.api = buildApiHandler(apiConfigForHandler, currentMode)
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error(`Failed to update API configuration: ${error}`)
		throw error
	}
}
