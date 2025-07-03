import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiConfiguration } from "@shared/api"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { UpdateApiConfigurationRequest } from "@shared/proto/models"

export const useApiConfigurationHandlers = () => {
	const { apiConfiguration } = useExtensionState()

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
	const handleFieldChange = <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => {
		const updatedConfig = {
			...apiConfiguration,
			[field]: value,
		}

		const protoConfig = convertApiConfigurationToProto(updatedConfig)
		ModelsServiceClient.updateApiConfigurationProto(
			UpdateApiConfigurationRequest.create({
				apiConfiguration: protoConfig,
			}),
		).catch((error) => {
			console.error(`Failed to update API configuration field ${field}:`, error)
		})
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
	const handleFieldsChange = (updates: Partial<ApiConfiguration>) => {
		const updatedConfig = {
			...apiConfiguration,
			...updates,
		}

		const protoConfig = convertApiConfigurationToProto(updatedConfig)
		ModelsServiceClient.updateApiConfigurationProto(
			UpdateApiConfigurationRequest.create({
				apiConfiguration: protoConfig,
			}),
		).catch((error) => {
			console.error("Failed to update API configuration fields:", error)
		})
	}

	return { handleFieldChange, handleFieldsChange }
}
