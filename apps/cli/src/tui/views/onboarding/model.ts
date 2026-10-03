import type {
	ChatModelModalities,
	ModelModality,
	ModelOperation,
} from "@cline/shared";
import { isChatProviderModel } from "../../../utils/chat-models";
import type {
	LocalCliStatus,
	ProviderLocalCli,
} from "../../../utils/local-cli";
import {
	isLocalAuthProvider,
	isOAuthProvider,
} from "../../../utils/provider-auth";

export type OnboardingStep =
	| "menu"
	| "oauth_pending"
	| "device_code"
	| "byo_provider"
	| "byo_apikey"
	| "local_cli_setup"
	| "cline_pass_subscription"
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

export const DEFAULT_THINKING_LEVEL_INDEX = THINKING_LEVELS.findIndex(
	(l) => l.value === "medium",
);

export interface MenuOption {
	label: string;
	value: string;
	detail: string;
	icon: string;
}

export type ClinePassSubscriptionAction =
	| "subscribe"
	| "refresh"
	| "skip"
	| "back";

export interface ClinePassSubscriptionOption {
	value: ClinePassSubscriptionAction;
	label: string;
}

export const MAIN_MENU: MenuOption[] = [
	{
		label: "Sign in with Cline",
		value: "cline",
		detail: "Latest models with regular free promos",
		icon: "\u263a",
	},
	{
		label: "Sign in with ClinePass",
		value: "cline-pass",
		detail: "Low cost subscription for everyone",
		icon: "\u2726",
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

/**
 * Which setup flow a provider needs. Keyed off how the provider authenticates,
 * so every caller routes the same way.
 */
export type ProviderSetupRoute = "oauth" | "local_cli" | "api_key";

export function resolveProviderSetupRoute(
	providerId: string,
): ProviderSetupRoute {
	if (isOAuthProvider(providerId)) return "oauth";
	if (isLocalAuthProvider(providerId)) return "local_cli";
	return "api_key";
}

/**
 * Whether the local-CLI setup screen lets the user connect.
 */
export function canContinueLocalCliSetup(
	_cli: ProviderLocalCli | undefined,
	_status: LocalCliStatus | undefined,
): boolean {
	// The probe only looks on PATH, while the runtime also accepts an explicit
	// pathToClaudeCodeExecutable and a bundled platform binary, and Codex falls
	// back through `npx`. A PATH miss therefore means "not on PATH", not
	// "unusable", so the screen reports it without blocking — a provider that
	// really cannot start says so on the first turn, in its own words.
	return true;
}

export function getMainMenuOptions(options?: {
	isClinePassEnabled?: boolean;
}): MenuOption[] {
	return MAIN_MENU.filter(
		(option) => option.value !== "cline-pass" || options?.isClinePassEnabled,
	);
}

export const CLINE_PASS_SUBSCRIPTION_OPTIONS: ClinePassSubscriptionOption[] = [
	{
		value: "subscribe",
		label: "Subscribe to ClinePass",
	},
	{
		value: "refresh",
		label: "Re-check subscription status",
	},
	{
		value: "skip",
		label: "Skip for now",
	},
	{
		value: "back",
		label: "Go back",
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
	isLocalAuth: boolean;
	hasAuth: boolean;
	capabilities?: readonly string[];
	models: number | null;
	defaultModelId?: string;
}

export interface ModelEntry {
	id: string;
	name: string;
	supportsReasoning: boolean;
}

export type ClinePassSubscriptionStatus =
	| "loading"
	| "subscribed"
	| "unsubscribed"
	| "error";

export interface ProviderCatalogItem {
	id: string;
	name: string;
	apiKey?: string;
	oauthAccessTokenPresent?: boolean;
	capabilities?: readonly string[];
	models: number | null;
	defaultModelId?: string;
}

export interface ProviderModelItem {
	id: string;
	name?: string;
	supportsReasoning?: boolean;
	operation?: ModelOperation;
	inputModalities?: ModelModality[];
	outputModalities?: ModelModality[];
}

export interface KnownModelInfo {
	name?: string;
	capabilities?: string[];
	operation?: ModelOperation;
	modalities?: ChatModelModalities;
}

export function toProviderEntry(provider: ProviderCatalogItem): ProviderEntry {
	return {
		id: provider.id,
		name: provider.name,
		isOAuth: isOAuthProvider(provider.id),
		isLocalAuth: isLocalAuthProvider(provider.id),
		hasAuth:
			Boolean(provider.apiKey) || provider.oauthAccessTokenPresent === true,
		...(provider.capabilities ? { capabilities: provider.capabilities } : {}),
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

export function toModelEntriesFromKnownModels(
	knownModels: Record<string, KnownModelInfo> | undefined,
): ModelEntry[] {
	if (!knownModels) return [];
	return Object.entries(knownModels)
		.filter(([, info]) =>
			isChatProviderModel({
				operation: info.operation,
				inputModalities: info.modalities?.input,
				outputModalities: info.modalities?.output,
			}),
		)
		.map(([id, info]) => ({
			id,
			name: info.name || id,
			supportsReasoning: info.capabilities?.includes("reasoning") ?? false,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function getOAuthProviderLabel(providerId: string): string {
	if (providerId === "cline-pass") {
		return "ClinePass";
	}
	if (providerId === "cline") {
		return "Cline";
	}
	if (providerId === "openai-codex") {
		return "ChatGPT";
	}
	return providerId;
}

export function shouldUseFeaturedClineModelPicker(providerId: string): boolean {
	// ClinePass uses the featured picker too, with Subscribed/Free sections
	return providerId === "cline" || providerId === "cline-pass";
}
