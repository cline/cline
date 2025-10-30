import { Empty } from "@shared/proto/cline/common"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { buildApiHandler } from "@/core/api"
import { ApiHandlerOptions, ApiHandlerSecrets, ApiProvider } from "@/shared/api"
import { UpdateApiConfigurationRequestNew } from "@/shared/proto/index.cline"
import type { Controller } from "../index"

/**
 * Updates API configuration
 * @param controller The controller instance
 * @param request The update API configuration request
 * @returns Empty response
 */
export async function updateApiConfiguration(controller: Controller, request: UpdateApiConfigurationRequestNew): Promise<Empty> {
	try {
		const { options: protoOptions, secrets: protoSecrets } = request

		const secrets: Partial<ApiHandlerSecrets> = {}
		if (protoSecrets) {
			const filteredSecrets = Object.fromEntries(Object.entries(protoSecrets).filter(([_, value]) => value !== undefined))
			Object.assign(secrets, filteredSecrets)
		}

		const options: Partial<ApiHandlerOptions> & { planModeApiProvider?: ApiProvider; actModeApiProvider?: ApiProvider } = {}
		if (protoOptions) {
			// Extract fields requiring conversion or special handling
			const {
				// Fields requiring enum conversion
				planModeApiProvider,
				actModeApiProvider,

				// Fields requiring special handling
				openAiHeaders,
				...simpleOptions
			} = protoOptions

			// Batch update for simple pass-through fields
			const filteredOptions = Object.fromEntries(Object.entries(simpleOptions).filter(([_, value]) => value !== undefined))
			Object.assign(options, filteredOptions)

			// Handle openAiHeaders (skip empty objects)
			if (openAiHeaders && Object.keys(openAiHeaders).length > 0) {
				options.openAiHeaders = openAiHeaders
			}

			// Convert proto ApiProvider enums to native string types
			if (planModeApiProvider !== undefined) {
				options.planModeApiProvider = convertProtoToApiProvider(planModeApiProvider)
			}
			if (actModeApiProvider !== undefined) {
				options.actModeApiProvider = convertProtoToApiProvider(actModeApiProvider)
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
