import { type ApiProvider, BEDROCK_DEFAULT_MODEL_ID } from "../api"
import type { SettingsKey } from "./state-keys"

export function getProviderModelIdKey(_provider: ApiProvider | string, mode: "act" | "plan"): SettingsKey {
	return `${mode}ModeApiModelId`
}

export function getProviderDefaultModelId(_provider: ApiProvider | string): string {
	return BEDROCK_DEFAULT_MODEL_ID
}
