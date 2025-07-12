import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiConfiguration } from "@shared/api"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { UpdateApiConfigurationRequest, ApiProvider as ProtoApiProvider } from "@shared/proto/models"

// Manual enum conversion for API provider to fix standalone mode
function convertApiProviderToProtoEnum(provider: string | undefined): ProtoApiProvider {
	switch (provider) {
		case "anthropic":
			return ProtoApiProvider.ANTHROPIC
		case "openrouter":
			return ProtoApiProvider.OPENROUTER
		case "bedrock":
			return ProtoApiProvider.BEDROCK
		case "vertex":
			return ProtoApiProvider.VERTEX
		case "openai":
			return ProtoApiProvider.OPENAI
		case "ollama":
			return ProtoApiProvider.OLLAMA
		case "lmstudio":
			return ProtoApiProvider.LMSTUDIO
		case "gemini":
			return ProtoApiProvider.GEMINI
		case "openai-native":
			return ProtoApiProvider.OPENAI_NATIVE
		case "requesty":
			return ProtoApiProvider.REQUESTY
		case "together":
			return ProtoApiProvider.TOGETHER
		case "deepseek":
			return ProtoApiProvider.DEEPSEEK
		case "qwen":
			return ProtoApiProvider.QWEN
		case "doubao":
			return ProtoApiProvider.DOUBAO
		case "mistral":
			return ProtoApiProvider.MISTRAL
		case "vscode-lm":
			return ProtoApiProvider.VSCODE_LM
		case "cline":
			return ProtoApiProvider.CLINE
		case "litellm":
			return ProtoApiProvider.LITELLM
		case "nebius":
			return ProtoApiProvider.NEBIUS
		case "fireworks":
			return ProtoApiProvider.FIREWORKS
		case "asksage":
			return ProtoApiProvider.ASKSAGE
		case "xai":
			return ProtoApiProvider.XAI
		case "sambanova":
			return ProtoApiProvider.SAMBANOVA
		case "cerebras":
			return ProtoApiProvider.CEREBRAS
		case "sapaicore":
			return ProtoApiProvider.SAPAICORE
		case "claude-code":
			return ProtoApiProvider.CLAUDE_CODE
		default:
			return ProtoApiProvider.ANTHROPIC
	}
}

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
		// Create the updated configuration by merging with existing config
		const updatedConfig = {
			...apiConfiguration,
			[field]: value,
		}

		// Convert the complete configuration to protobuf format
		const protoConfig = convertApiConfigurationToProto(updatedConfig)

		// Fix enum conversion for standalone mode
		if (protoConfig.apiProvider !== undefined) {
			protoConfig.apiProvider = convertApiProviderToProtoEnum(updatedConfig.apiProvider)
			console.log(
				`🔧 [API-CONFIG-DEBUG] Setting apiProvider to ${updatedConfig.apiProvider} (enum ${protoConfig.apiProvider})`,
			)
		}

		// Send the complete configuration using proper protobuf request
		ModelsServiceClient.updateApiConfigurationProto(
			UpdateApiConfigurationRequest.fromPartial({
				apiConfiguration: protoConfig,
			}),
		)
			.then((response) => {
				// Success - response received
			})
			.catch((error) => {
				console.error(`🔧 [API-CONFIG-DEBUG] Failed to update API configuration field ${field}:`, error)
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

		// Fix enum conversion for standalone mode
		if (protoConfig.apiProvider !== undefined) {
			protoConfig.apiProvider = convertApiProviderToProtoEnum(updatedConfig.apiProvider)
		}

		ModelsServiceClient.updateApiConfigurationProto(
			UpdateApiConfigurationRequest.fromPartial({
				apiConfiguration: protoConfig,
			}),
		).catch((error) => {
			console.error("Failed to update API configuration fields:", error)
		})
	}

	return { handleFieldChange, handleFieldsChange }
}
