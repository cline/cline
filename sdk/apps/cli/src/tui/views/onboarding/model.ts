import { isOAuthProvider } from "../../../utils/provider-auth";

export type OnboardingStep =
	| "menu"
	| "oauth_pending"
	| "device_code"
	| "byo_provider"
	| "byo_apikey"
	| "cline_model"
	| "model_picker"
	| "custom_model_id"
	| "thinking_level"
	| "done";

export type ThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh";
export type ReasoningEffort = Exclude<ThinkingLevel, "none">;

export const THINKING_LEVELS: {
	value: ThinkingLevel;
	label: string;
	desc: string;
}[] = [
	{ value: "none", label: "Off", desc: "No extended thinking" },
	{ value: "low", label: "Low", desc: "Minimal reasoning" },
	{ value: "medium", label: "Medium", desc: "Balanced reasoning" },
	{ value: "high", label: "High", desc: "Deep reasoning" },
	{ value: "xhigh", label: "Extra High", desc: "Maximum reasoning" },
];

export interface MenuOption {
	label: string;
	value: string;
	detail: string;
	icon: string;
}

export const MAIN_MENU: MenuOption[] = [
	{
		label: "Sign in with Cline",
		value: "cline",
		detail: "Latest models with regular free promos",
		icon: "\u263a",
	},
	{
		label: "Sign in with ChatGPT",
		value: "openai-codex",
		detail: "Use your ChatGPT Plus subscription",
		icon: "\u2726",
	},
	{
		label: "Bring your own provider",
		value: "byo",
		detail: "API key or local server (e.g. Ollama)",
		icon: "\u26b7",
	},
];

export interface OnboardingResult {
	providerId: string;
	modelId: string;
	apiKey?: string;
	thinking?: boolean;
	reasoningEffort?: ReasoningEffort;
}

export interface ProviderEntry {
	id: string;
	name: string;
	isOAuth: boolean;
	hasAuth: boolean;
	models: number | null;
	defaultModelId?: string;
}

export interface ModelEntry {
	id: string;
	name: string;
	supportsReasoning: boolean;
}

export interface ProviderCatalogItem {
	id: string;
	name: string;
	apiKey?: string;
	oauthAccessTokenPresent?: boolean;
	models: number | null;
	defaultModelId?: string;
}

export interface ProviderModelItem {
	id: string;
	name?: string;
	supportsReasoning?: boolean;
}

export function toProviderEntry(provider: ProviderCatalogItem): ProviderEntry {
	return {
		id: provider.id,
		name: provider.name,
		isOAuth: isOAuthProvider(provider.id),
		hasAuth:
			Boolean(provider.apiKey) || provider.oauthAccessTokenPresent === true,
		models: provider.models,
		defaultModelId: provider.defaultModelId,
	};
}

export function toModelEntry(model: ProviderModelItem): ModelEntry {
	return {
		id: model.id,
		name: model.name || model.id,
		supportsReasoning: model.supportsReasoning === true,
	};
}

export function getOAuthProviderLabel(providerId: string): string {
	if (providerId === "cline") {
		return "Cline";
	}
	if (providerId === "openai-codex") {
		return "ChatGPT";
	}
	return providerId;
}
