import type {
	SessionConfigOption,
	SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";
import { buildAutoApproveConfigOption } from "./auto-approve";

// Clients break category ties by array order, so the provider must not claim
// the model selector's category when it comes first.
export const PROVIDER_CONFIG_CATEGORY = "_provider";
export const MODEL_CONFIG_CATEGORY = "model";

interface ConfigOptionsInput {
	currentProviderId: string;
	providerOptions: SessionConfigSelectOption[];
	currentModelId: string;
	providerModels: Record<string, { name?: string; description?: string }>;
	currentMode: string;
	autoApproveTools: boolean;
	organizationOption?: SessionConfigOption;
}

export function buildProviderConfigOption(
	currentProviderId: string,
	options: SessionConfigSelectOption[],
): SessionConfigOption {
	return {
		type: "select",
		id: "provider",
		name: "Provider",
		description: "The authentication provider to use",
		category: PROVIDER_CONFIG_CATEGORY,
		currentValue: currentProviderId,
		options,
	};
}

export function buildModelConfigOption(
	currentModelId: string,
	providerModels: Record<string, { name?: string; description?: string }>,
): SessionConfigOption {
	return {
		type: "select",
		id: "model",
		name: "Model",
		category: MODEL_CONFIG_CATEGORY,
		currentValue: currentModelId,
		options: Object.entries(providerModels).map(([modelId, info]) => ({
			value: modelId,
			name: info.name ?? modelId,
			description: info.description,
		})),
	};
}

function buildModeConfigOption(currentMode: string): SessionConfigOption {
	return {
		type: "select",
		id: "mode",
		name: "Session Mode",
		description: "Controls whether the agent can modify files",
		category: "mode",
		currentValue: currentMode,
		options: [
			{
				value: "plan",
				name: "Plan",
				description:
					"Explore the codebase and plan changes without modifying files",
			},
			{
				value: "act",
				name: "Act",
				description: "Make changes to the codebase",
			},
		],
	};
}

export function buildConfigOptions({
	currentProviderId,
	providerOptions,
	currentModelId,
	providerModels,
	currentMode,
	autoApproveTools,
	organizationOption,
}: ConfigOptionsInput): SessionConfigOption[] {
	return [
		buildProviderConfigOption(currentProviderId, providerOptions),
		buildModelConfigOption(currentModelId, providerModels),
		buildModeConfigOption(currentMode),
		buildAutoApproveConfigOption(autoApproveTools),
		...(organizationOption ? [organizationOption] : []),
	];
}
