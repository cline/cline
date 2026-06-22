// Maps the legacy ApiConfiguration (plan/act provider + model + API key fields) onto the SDK's
// CoreSessionConfig. Distilled from the deleted apps/vscode/src/sdk/cline-session-factory.ts.
//
// Kept lean but correct for the common providers. Cloud providers (bedrock/vertex) and the
// long tail are reachable via the generic key/model maps; richer structured cloud auth is a
// follow-up. The goal is a buildable, working provider resolution path.

import type { CoreSessionConfig } from "@cline/core"
import { normalizeProviderId } from "@cline/core"
import { getProviderCollectionSync } from "@cline/llms"
import { buildClineSystemPrompt } from "@cline/shared"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"

export type SessionMode = Extract<Mode, "plan" | "act">

const DEFAULT_PROVIDER_ID = "cline"

/**
 * Provider id -> ApiConfiguration field holding that provider's API key.
 * Covers the providers most users select; unknown providers fall back to `apiKey`.
 */
export const PROVIDER_API_KEY_MAP: Partial<Record<string, keyof ApiConfiguration>> = {
	anthropic: "apiKey",
	"claude-code": "apiKey",
	openrouter: "openRouterApiKey",
	openai: "openAiApiKey",
	"openai-native": "openAiNativeApiKey",
	bedrock: "awsBedrockApiKey",
	vertex: "geminiApiKey",
	gemini: "geminiApiKey",
	deepseek: "deepSeekApiKey",
	cline: "clineApiKey",
	"cline-pass": "clineApiKey",
	ollama: "ollamaApiKey",
	requesty: "requestyApiKey",
	together: "togetherApiKey",
	fireworks: "fireworksApiKey",
	qwen: "qwenApiKey",
	"qwen-code": "qwenApiKey",
	doubao: "doubaoApiKey",
	mistral: "mistralApiKey",
	litellm: "liteLlmApiKey",
	asksage: "asksageApiKey",
	xai: "xaiApiKey",
	moonshot: "moonshotApiKey",
	zai: "zaiApiKey",
	huggingface: "huggingFaceApiKey",
	nebius: "nebiusApiKey",
	sambanova: "sambanovaApiKey",
	cerebras: "cerebrasApiKey",
	groq: "groqApiKey",
	baseten: "basetenApiKey",
	"huawei-cloud-maas": "huaweiCloudMaasApiKey",
	dify: "difyApiKey",
	minimax: "minimaxApiKey",
	hicap: "hicapApiKey",
	aihubmix: "aihubmixApiKey",
	nousResearch: "nousResearchApiKey",
	"vercel-ai-gateway": "vercelAiGatewayApiKey",
	wandb: "wandbApiKey",
	oca: "ocaApiKey",
}

/** Provider id -> mode-specific model-id fields in ApiConfiguration. */
const PROVIDER_MODEL_ID_MAP: Partial<Record<string, { plan: keyof ApiConfiguration; act: keyof ApiConfiguration }>> = {
	openrouter: { plan: "planModeOpenRouterModelId", act: "actModeOpenRouterModelId" },
	openai: { plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" },
	ollama: { plan: "planModeOllamaModelId", act: "actModeOllamaModelId" },
	lmstudio: { plan: "planModeLmStudioModelId", act: "actModeLmStudioModelId" },
	cline: { plan: "planModeClineModelId", act: "actModeClineModelId" },
	"cline-pass": { plan: "planModeClinePassModelId", act: "actModeClinePassModelId" },
	litellm: { plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
	requesty: { plan: "planModeRequestyModelId", act: "actModeRequestyModelId" },
	together: { plan: "planModeTogetherModelId", act: "actModeTogetherModelId" },
	fireworks: { plan: "planModeFireworksModelId", act: "actModeFireworksModelId" },
	groq: { plan: "planModeGroqModelId", act: "actModeGroqModelId" },
	baseten: { plan: "planModeBasetenModelId", act: "actModeBasetenModelId" },
	huggingface: { plan: "planModeHuggingFaceModelId", act: "actModeHuggingFaceModelId" },
	oca: { plan: "planModeOcaModelId", act: "actModeOcaModelId" },
	aihubmix: { plan: "planModeAihubmixModelId", act: "actModeAihubmixModelId" },
	hicap: { plan: "planModeHicapModelId", act: "actModeHicapModelId" },
	nousResearch: { plan: "planModeNousResearchModelId", act: "actModeNousResearchModelId" },
	"vercel-ai-gateway": { plan: "planModeVercelAiGatewayModelId", act: "actModeVercelAiGatewayModelId" },
	sapaicore: { plan: "planModeSapAiCoreModelId", act: "actModeSapAiCoreModelId" },
}

/** Provider id -> ApiConfiguration field holding the base URL, when applicable. */
const PROVIDER_BASE_URL_MAP: Partial<Record<string, keyof ApiConfiguration>> = {
	anthropic: "anthropicBaseUrl",
	openai: "openAiBaseUrl",
	ollama: "ollamaBaseUrl",
	lmstudio: "lmStudioBaseUrl",
	gemini: "geminiBaseUrl",
	requesty: "requestyBaseUrl",
	litellm: "liteLlmBaseUrl",
	oca: "ocaBaseUrl",
	aihubmix: "aihubmixBaseUrl",
	dify: "difyBaseUrl",
}

function stringField(config: ApiConfiguration, field: keyof ApiConfiguration | undefined): string | undefined {
	if (!field) {
		return undefined
	}
	const value = config[field]
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function resolveProviderId(config: ApiConfiguration, mode: SessionMode): string {
	const provider = mode === "plan" ? config.planModeApiProvider : config.actModeApiProvider
	return (provider as string | undefined)?.trim() || DEFAULT_PROVIDER_ID
}

function resolveModelId(config: ApiConfiguration, providerId: string, mode: SessionMode): string {
	const fields = PROVIDER_MODEL_ID_MAP[providerId]
	if (fields) {
		const fromDedicated = stringField(config, mode === "plan" ? fields.plan : fields.act)
		if (fromDedicated) {
			return fromDedicated
		}
	}
	const generic = stringField(config, mode === "plan" ? "planModeApiModelId" : "actModeApiModelId")
	return generic ?? ""
}

/** The provider's default model from the SDK catalog, used when the user hasn't selected one. */
function resolveDefaultModelId(sdkProviderId: string): string {
	try {
		const collection = getProviderCollectionSync(sdkProviderId)
		return collection?.provider?.defaultModelId ?? ""
	} catch {
		return ""
	}
}

function resolveApiKey(config: ApiConfiguration, providerId: string): string | undefined {
	const field = PROVIDER_API_KEY_MAP[providerId] ?? "apiKey"
	return stringField(config, field)
}

function resolveBaseUrl(config: ApiConfiguration, providerId: string): string | undefined {
	return stringField(config, PROVIDER_BASE_URL_MAP[providerId])
}

function workspaceName(workspaceRoot: string): string {
	return workspaceRoot.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || "workspace"
}

const PLAN_MODE_INSTRUCTIONS = `# Plan Mode

You are in Plan mode. Your role is to explore, analyze, and plan -- not to execute.

- Read files, search the codebase, and gather context to understand the problem
- Present your plan as a structured outline with clear steps
- Do NOT edit files, write code, run destructive commands, or make any changes

Once the user approves your plan in a follow-up message, use the switch_to_act_mode tool to begin implementation. Never treat the original task request as approval -- end your turn after presenting the plan and wait for the user's response.`

/**
 * Build a CoreSessionConfig from the legacy ApiConfiguration for the given mode.
 *
 * `cwd` and `workspaceRoot` must be resolved by the caller (the Controller resolves them from
 * the host workspace). The returned config always carries a provider/model even when the user
 * has not configured credentials, so the UI can surface the correct auth state on first send.
 */
export function buildSessionConfig(
	apiConfiguration: ApiConfiguration,
	mode: SessionMode,
	cwd: string,
	workspaceRoot?: string,
): CoreSessionConfig {
	const resolvedWorkspaceRoot = workspaceRoot?.trim() || cwd
	const providerId = resolveProviderId(apiConfiguration, mode)
	const sdkProviderId = normalizeProviderId(providerId)
	// Resolve the model from the user's config; if none is selected (e.g. a fresh install),
	// fall back to the provider's default model from the SDK catalog. An empty model id is
	// rejected by the SDK ("model: expected string to have >=1 characters").
	const modelId = resolveModelId(apiConfiguration, providerId, mode) || resolveDefaultModelId(sdkProviderId)
	const apiKey = resolveApiKey(apiConfiguration, providerId)
	const baseUrl = resolveBaseUrl(apiConfiguration, providerId)

	let systemPrompt: string
	try {
		systemPrompt = buildClineSystemPrompt({
			ide: "VS Code",
			workspaceRoot: resolvedWorkspaceRoot,
			workspaceName: workspaceName(resolvedWorkspaceRoot),
			mode,
			providerId: sdkProviderId,
			platform: process.platform,
		})
	} catch {
		systemPrompt = "You are Cline, a highly skilled software engineer. Help the user with their request."
	}
	if (mode === "plan") {
		systemPrompt = `${systemPrompt}\n\n${PLAN_MODE_INSTRUCTIONS}`
	}

	const providerConfig = {
		providerId: sdkProviderId,
		modelId,
		...(apiKey ? { apiKey } : {}),
		...(baseUrl ? { baseUrl } : {}),
	}

	const config: CoreSessionConfig = {
		providerId: sdkProviderId,
		modelId,
		apiKey: apiKey ?? "",
		...(baseUrl ? { baseUrl } : {}),
		providerConfig,
		cwd,
		workspaceRoot: resolvedWorkspaceRoot,
		systemPrompt,
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		disableMcpSettingsTools: true,
		mode,
		extensionContext: {
			client: { name: "cline-vscode", version: "0.0.0" },
			workspace: {
				rootPath: resolvedWorkspaceRoot,
				cwd,
				workspaceName: workspaceName(resolvedWorkspaceRoot),
				ide: "VS Code",
				platform: process.platform,
				mode,
			},
		},
	}

	return config
}

export { DEFAULT_PROVIDER_ID }
