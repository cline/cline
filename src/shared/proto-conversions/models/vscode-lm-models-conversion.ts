import { LanguageModelChatSelector } from "@shared/proto/cline/models"

/**
 * Represents a VS Code language model in the native VS Code format
 */
export interface VsCodeNativeModel {
	vendor?: string
	family?: string
	version?: string
	id?: string
}

/**
 * Converts VS Code native model format to protobuf format
 */
export function convertVsCodeNativeModelsToProtoModels(models: VsCodeNativeModel[]): LanguageModelChatSelector[] {
	return (models || []).map((model) => ({
		vendor: model.vendor || "",
		family: model.family || "",
		version: model.version || "",
		id: model.id || "",
	}))
}
