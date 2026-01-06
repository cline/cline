import { ApiConfiguration } from "@shared/api"
import { UpdateApiConfigurationRequest } from "@shared/proto/cline/models"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

export const useApiConfigurationHandlers = () => {
	const { apiConfiguration, planActSeparateModelsSetting } = useExtensionState()

	/**
	 * Updates a single field in the API configuration.
	 *
	 * **Warning**: If this function is called multiple times in rapid succession,
	 * it can lead to race conditions where later calls may overwrite changes from
	 * earlier calls. For updating multiple fields, use `handleFieldsChange` instead.
	 *
	 * @param field - The field key to update
	 * @param value - The new value for the field
	 */
	const handleFieldChange = async <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => {
		const updatedConfig = {
			...apiConfiguration,
			[field]: value,
		}

		const protoConfig = convertApiConfigurationToProto(updatedConfig)
		await ModelsServiceClient.updateApiConfigurationProto(
			UpdateApiConfigurationRequest.create({
				apiConfiguration: protoConfig,
			}),
		)
	}

	/**
	 * Updates multiple fields in the API configuration at once.
	 *
	 * This function should be used when updating multiple fields to avoid race conditions
	 * that can occur when calling `handleFieldChange` multiple times in succession.
	 * All updates are applied together as a single operation.
	 *
	 * @param updates - An object containing the fields to update and their new values
	 */
	const handleFieldsChange = async (updates: Partial<ApiConfiguration>) => {
		const updatedConfig = {
			...apiConfiguration,
			...updates,
		}

		const protoConfig = convertApiConfigurationToProto(updatedConfig)
		await ModelsServiceClient.updateApiConfigurationProto(
			UpdateApiConfigurationRequest.create({
				apiConfiguration: protoConfig,
			}),
		)
	}

	const handleModeFieldChange = async <PlanK extends keyof ApiConfiguration, ActK extends keyof ApiConfiguration>(
		fieldPair: { plan: PlanK; act: ActK },
		value: ApiConfiguration[PlanK] & ApiConfiguration[ActK], // Intersection ensures value is compatible with both field types
		currentMode: Mode,
	) => {
		if (planActSeparateModelsSetting) {
			const targetField = fieldPair[currentMode]
			await handleFieldChange(targetField, value)
		} else {
			await handleFieldsChange({
				[fieldPair.plan]: value,
				[fieldPair.act]: value,
			})
		}
	}

	/**
	 * Updates multiple mode-specific fields in a single atomic operation.
	 *
	 * This prevents race conditions that can occur when making multiple separate
	 * handleModeFieldChange calls in rapid succession.
	 *
	 * @param fieldPairs - Object mapping keys to plan/act field pairs
	 * @param values - Object with values for each key
	 * @param currentMode - The current mode being targeted
	 */
	const handleModeFieldsChange = async <T extends Record<string, any>>(
		fieldPairs: { [K in keyof T]: { plan: keyof ApiConfiguration; act: keyof ApiConfiguration } },
		values: T,
		currentMode: Mode,
	) => {
		if (planActSeparateModelsSetting) {
			// Update only the current mode's fields
			const updates: Partial<ApiConfiguration> = {}
			Object.entries(fieldPairs).forEach(([key, { plan, act }]) => {
				const targetField = currentMode === "plan" ? plan : act
				updates[targetField] = values[key]
			})
			await handleFieldsChange(updates)
		} else {
			// Update both modes' fields
			const updates: Partial<ApiConfiguration> = {}
			Object.entries(fieldPairs).forEach(([key, { plan, act }]) => {
				updates[plan] = values[key]
				updates[act] = values[key]
			})
			await handleFieldsChange(updates)
		}
	}

	return { handleFieldChange, handleFieldsChange, handleModeFieldChange, handleModeFieldsChange }
}
