import { VsCodeLmModel } from "../../proto/models"

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
export function convertVsCodeNativeModelsToProtoModels(models: VsCodeNativeModel[]): VsCodeLmModel[] {
	return (models || []).map((model) => ({
		vendor: model.vendor || "",
		family: model.family || "",
		version: model.version || "",
		id: model.id || "",
	}))
}
