import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiConfiguration } from "@shared/api"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { UpdateApiConfigurationRequest } from "@shared/proto/models"

// webview-ui/src/utils/apiConfiguration.ts
export const useApiConfigurationHandlers = () => {
	const { apiConfiguration } = useExtensionState()

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
