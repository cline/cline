import { buildApiHandler, createHandlerForProvider } from "@core/api"
import { clampThinkingBudget } from "@core/api/utils/thinkingBudgetValidation"
import { ApiConfiguration } from "@shared/api"
import { Empty } from "@shared/proto/cline/common"
import { UpdateApiConfigurationRequest } from "@shared/proto/cline/models"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import type { Controller } from "../index"

/**
 * Validates and clamps thinking budget tokens to ensure they don't exceed model limits
 * @param config The API configuration to validate
 * @returns The validated configuration with clamped thinking budget values
 */
function validateAndClampThinkingBudgets(config: ApiConfiguration): ApiConfiguration {
	try {
		let configChanged = false
		const validatedConfig = { ...config }

		// Validate plan mode thinking budget
		if (validatedConfig.planModeThinkingBudgetTokens && validatedConfig.planModeThinkingBudgetTokens > 0) {
			const planHandler = createHandlerForProvider(validatedConfig.planModeApiProvider, validatedConfig, "plan")
			const planModelInfo = planHandler.getModel().info
			const clampedPlanValue = clampThinkingBudget(validatedConfig.planModeThinkingBudgetTokens, planModelInfo)

			if (clampedPlanValue !== validatedConfig.planModeThinkingBudgetTokens) {
				validatedConfig.planModeThinkingBudgetTokens = clampedPlanValue
				configChanged = true
			}
		}

		// Validate act mode thinking budget
		if (validatedConfig.actModeThinkingBudgetTokens && validatedConfig.actModeThinkingBudgetTokens > 0) {
			const actHandler = createHandlerForProvider(validatedConfig.actModeApiProvider, validatedConfig, "act")
			const actModelInfo = actHandler.getModel().info
			const clampedActValue = clampThinkingBudget(validatedConfig.actModeThinkingBudgetTokens, actModelInfo)

			if (clampedActValue !== validatedConfig.actModeThinkingBudgetTokens) {
				validatedConfig.actModeThinkingBudgetTokens = clampedActValue
				configChanged = true
			}
		}

		return validatedConfig
	} catch (error) {
		console.error("[APICONFIG: validateAndClampThinkingBudgets] Error validating thinking budgets:", error)
		return config // Return original config if validation fails
	}
}

/**
 * Updates API configuration
 * @param controller The controller instance
 * @param request The update API configuration request
 * @returns Empty response
 */
export async function updateApiConfigurationProto(
	controller: Controller,
	request: UpdateApiConfigurationRequest,
): Promise<Empty> {
	try {
		if (!request.apiConfiguration) {
			console.log("[APICONFIG: updateApiConfigurationProto] API configuration is required")
			throw new Error("API configuration is required")
		}

		// Convert proto ApiConfiguration to application ApiConfiguration
		const appApiConfiguration = convertProtoToApiConfiguration(request.apiConfiguration)

		// Validate and clamp thinking budget tokens before persisting
		const validatedConfig = validateAndClampThinkingBudgets(appApiConfiguration)

		// Update the API configuration in storage
		controller.stateManager.setApiConfiguration(validatedConfig)

		// Update the task's API handler if there's an active task
		if (controller.task) {
			const currentMode = await controller.getCurrentMode()
			controller.task.api = buildApiHandler({ ...validatedConfig, ulid: controller.task.ulid }, currentMode)
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error(`Failed to update API configuration: ${error}`)
		throw error
	}
}
