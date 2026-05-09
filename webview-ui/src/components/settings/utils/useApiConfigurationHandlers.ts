import { ApiConfiguration } from "@shared/api"
import { UpdateApiConfigurationRequest } from "@shared/proto/cline/models"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

export const useApiConfigurationHandlers = () => {
	const { apiConfiguration, handleSetApiConfiguration } = useExtensionState()

	const handleFieldChange = async <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => {
		await handleFieldsChange({ [field]: value })
	}

	const handleFieldsChange = async (updates: Partial<ApiConfiguration>) => {
		const updatedConfig = {
			...apiConfiguration,
			...updates,
		}

		handleSetApiConfiguration(updatedConfig as ApiConfiguration)

		const protoConfig = convertApiConfigurationToProto(updatedConfig)
		await ModelsServiceClient.updateApiConfigurationProto(
			UpdateApiConfigurationRequest.create({
				apiConfiguration: protoConfig,
			}),
		)
	}

	const handleModeFieldChange = async (suffix: string, value: any, currentMode: Mode) => {
		const modeKey = currentMode === "plan" ? "planConfig" : "actConfig"
		await handleFieldsChange({
			[modeKey]: { ...(apiConfiguration as any)?.[modeKey], [suffix]: value },
		} as any)
	}

	return { handleFieldChange, handleFieldsChange, handleModeFieldChange }
}
