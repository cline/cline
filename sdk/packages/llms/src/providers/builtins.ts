import {
	CLINE_DEFAULT_MODEL_ID,
	type GatewayModelDefinition,
	type GatewayModelOperationCapability,
	type GatewayModelToolCapability,
	type GatewayProviderManifest,
	type GatewayProviderMetadata,
	type GatewayProviderSettings,
	getClineEnvironmentConfig,
	type JsonValue,
	type ProviderCapability,
	type ProviderConfigField,
} from "@cline/shared";
import { getGeneratedModelsForProvider } from "../catalog/catalog.generated-access";
import { filterImageOutputModels } from "../catalog/model-filters";
import {
	isCanonicalModelIdForAliasRules,
	preferCanonicalModelIds,
	VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES,
} from "../catalog/model-id-aliases";
import type {
	ModelCollection,
	ModelInfo,
	ProviderClient,
	ProviderProtocol,
} from "../catalog/types";
import type {
	BuiltinSpec,
	ProviderApiLine,
	ProviderFamily,
} from "./builtin-types";
import {
	ClineFreeModelLimitError,
	ClineNotSubscribedError,
	ClineOrgIndividualInferenceSubscriptionError,
	ClinePassLimitError,
	extractClinePassLimitMessage,
	isClineFreeModelLimitMessage,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionMessage,
} from "./errors";
import { normalizeProviderId } from "./ids";
import { toGatewayModelCapabilities } from "./model-capabilities";
import {
	BUILTIN_MODEL_OPERATION_CAPABILITIES,
	BUILTIN_TRANSCRIPTION_TRANSPORTS,
} from "./model-operations";
import { filterOpenAICodexModels } from "./openai-codex-models";
import { GENERATED_PROVIDER_SPECS } from "./providers.generated";
import {
	ANTHROPIC_AND_QWEN_CACHE_ROUTING_METADATA,
	ANTHROPIC_ROUTING_METADATA,
	QWEN_CACHE_ROUTING_METADATA,
} from "./routing/anthropic-compatible";
import { BEDROCK_ROUTING_METADATA } from "./routing/bedrock-cache-point";
import { GLM_THINKING_ROUTING_METADATA } from "./routing/glm-thinking";
import { MINIMAX_THINKING_ROUTING_METADATA } from "./routing/minimax-thinking";

export const DEFAULT_INTERNAL_OCA_BASE_URL =
	"https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";
export const DEFAULT_EXTERNAL_OCA_BASE_URL =
	"https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";
const CLINE_PASS_PROVIDER_ID = "cline-pass";
const OPENAI_CODEX_DEFAULT_MODEL_ID = "gpt-5.4";
const NATIVE_WEB_SEARCH_MODEL_TOOL_CAPABILITIES: readonly GatewayModelToolCapability[] =
	[{ name: "web_search" }];
const OPENAI_NATIVE_MODEL_TOOL_CAPABILITIES: readonly GatewayModelToolCapability[] =
	[
		...NATIVE_WEB_SEARCH_MODEL_TOOL_CAPABILITIES,
		{
			name: "image_generation",
			// The Responses API image tool augments language models; dedicated
			// image models use the separate image-generation operation instead.
			routes: [{ matcher: "model-operation", operation: "language" }],
		},
	];
const VERTEX_MODEL_TOOL_CAPABILITIES: readonly GatewayModelToolCapability[] = [
	{
		name: "web_search",
		// Vertex Claude is created through the Anthropic adapter, which does not
		// expose Google Search. Exclusions also cover unregistered Claude model ids.
		excludeRoutes: [{ matcher: "anthropic-compatible" }],
	},
];
const OPENROUTER_STICKY_SESSION_METADATA: GatewayProviderMetadata = {
	stickySession: {
		transport: "json-body",
		field: "session_id",
		metadataKey: "sessionId",
	},
};

/**
 * Context window requested from Ollama when neither the resolved model nor
 * the user's configuration supplies one. Matches the pre-SDK-migration
 * handler default; deliberately larger than Ollama's 4096 server default,
 * which cannot fit Cline's agentic prompts. Single source of truth — the
 * vendor, the VS Code session factory, and the settings UI all import this.
 */
export const OLLAMA_DEFAULT_CONTEXT_WINDOW = 32768;

export type {
	BuiltinSpec,
	ProviderApiLine,
	ProviderFamily,
} from "./builtin-types";

type BuiltinSpecOverride = Pick<BuiltinSpec, "id"> &
	Partial<Omit<BuiltinSpec, "id">>;

const API_KEY_FIELD: ProviderConfigField = {
	path: "apiKey",
	label: "API Key",
	type: "password",
	placeholder: "Enter API key...",
	description: "API key issued by the provider.",
	secret: true,
};

const BASE_URL_FIELD: ProviderConfigField = {
	path: "baseUrl",
	label: "Base URL",
	type: "url",
	placeholder: "https://...",
	description: "Base endpoint used for provider requests.",
};

const VERTEX_CONFIG_FIELDS: readonly ProviderConfigField[] = [
	{
		path: "gcp.projectId",
		label: "Google Cloud Project ID",
		type: "text",
		placeholder: "my-gcp-project",
		description: "Google Cloud project that owns the Vertex AI resources.",
		required: true,
	},
	{
		path: "gcp.region",
		label: "Vertex Region",
		type: "text",
		placeholder: "us-central1",
		description: "Vertex AI location to run models in.",
		defaultValue: "us-central1",
	},
	{
		...API_KEY_FIELD,
		label: "API Key",
		description:
			"Optional Google API key for Gemini models. Vertex Anthropic models use Google Cloud credentials.",
	},
];

const BEDROCK_CONFIG_FIELDS: readonly ProviderConfigField[] = [
	{
		path: "aws.authentication",
		label: "Authentication",
		type: "select",
		description: "Credential source for Amazon Bedrock requests.",
		options: [
			{ label: "AWS SDK / IAM", value: "iam" },
			{ label: "AWS Profile", value: "profile" },
			{ label: "API Key", value: "api-key" },
		],
		defaultValue: "iam",
	},
	{
		path: "aws.region",
		label: "AWS Region",
		type: "text",
		placeholder: "us-east-1",
		description: "AWS region for Bedrock runtime requests.",
	},
	{
		path: "aws.profile",
		label: "AWS Profile",
		type: "text",
		placeholder: "default",
		description: "Named AWS profile when using profile authentication.",
	},
	{
		path: "aws.accessKey",
		label: "Access Key ID",
		type: "password",
		placeholder: "AKIA...",
		secret: true,
	},
	{
		path: "aws.secretKey",
		label: "Secret Access Key",
		type: "password",
		secret: true,
	},
	{
		path: "aws.sessionToken",
		label: "Session Token",
		type: "password",
		secret: true,
	},
	{
		path: "apiKey",
		label: "Bedrock API Key",
		type: "password",
		description: "Optional Bedrock bearer token for API key authentication.",
		secret: true,
	},
	{
		path: "aws.endpoint",
		label: "Endpoint URL",
		type: "url",
		placeholder: "https://bedrock-runtime.us-east-1.amazonaws.com",
		description: "Optional custom Bedrock runtime endpoint.",
	},
	{
		path: "aws.useCrossRegionInference",
		label: "Cross-Region Inference",
		type: "boolean",
	},
	{
		path: "aws.useGlobalInference",
		label: "Global Inference",
		type: "boolean",
	},
	{
		path: "aws.usePromptCache",
		label: "Prompt Cache",
		type: "boolean",
	},
];

const OCA_CONFIG_FIELDS: readonly ProviderConfigField[] = [
	{
		path: "oca.mode",
		label: "OCA Mode",
		type: "select",
		options: [
			{ label: "External", value: "external" },
			{ label: "Internal", value: "internal" },
		],
		defaultValue: "external",
	},
	API_KEY_FIELD,
	{
		path: "oca.usePromptCache",
		label: "Prompt Cache",
		type: "boolean",
	},
];

const QWEN_API_LINE_BASE_URLS: Readonly<Record<ProviderApiLine, string>> = {
	china: "https://dashscope.aliyuncs.com/compatible-mode/v1",
	international: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
};

const QWEN_CONFIG_FIELDS: readonly ProviderConfigField[] = [
	API_KEY_FIELD,
	BASE_URL_FIELD,
	{
		path: "apiLine",
		label: "API Line",
		type: "select",
		description: "Regional API line for Qwen routing.",
		options: [
			{ label: "International", value: "international" },
			{ label: "China", value: "china" },
		],
	},
];

function defaultConfigFieldsForSpec(
	spec: BuiltinSpec,
): readonly ProviderConfigField[] {
	const fields: ProviderConfigField[] = [];
	if (spec.apiKeyEnv?.length) {
		fields.push(API_KEY_FIELD);
	}
	if (spec.defaults?.baseUrl?.trim()) {
		fields.push(BASE_URL_FIELD);
	}
	return fields;
}

function cloneModels(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(models).map(([id, info]) => [id, { ...info }]),
	);
}

function uniqueCapabilities(
	capabilities: readonly ProviderCapability[] | undefined,
): ProviderCapability[] | undefined {
	if (!capabilities?.length) return undefined;
	return [...new Set(capabilities)];
}

function getProviderCapabilities(
	spec: BuiltinSpec,
): ProviderCapability[] | undefined {
	return uniqueCapabilities([
		...(spec.capabilities ?? []),
		...(spec.popular !== undefined ? (["popular"] as const) : []),
	]);
}

function getProviderMetadata(
	spec: BuiltinSpec,
): GatewayProviderMetadata | undefined {
	const configFields = spec.configFields ?? defaultConfigFieldsForSpec(spec);
	const metadata: GatewayProviderMetadata = {
		...spec.metadata,
		configFields,
	};
	if (spec.popular !== undefined) {
		metadata.popularRank = spec.popular;
	}
	return metadata;
}

function mergeDefaults(
	base: GatewayProviderSettings | undefined,
	override: GatewayProviderSettings | undefined,
): GatewayProviderSettings | undefined {
	if (!override) {
		return base;
	}
	if (!base) {
		return override;
	}
	return {
		...base,
		...override,
	};
}

function mergeBuiltinSpec(
	base: BuiltinSpec | undefined,
	override: BuiltinSpecOverride,
): BuiltinSpec {
	const merged = {
		...base,
		...override,
		defaults: mergeDefaults(base?.defaults, override.defaults),
	};

	if (!merged.name || !merged.description || !merged.family) {
		throw new Error(
			`Builtin provider "${override.id}" is missing required provider metadata.`,
		);
	}

	return merged as BuiltinSpec;
}

function mergeBuiltinSpecs(
	generatedSpecs: readonly BuiltinSpec[],
	overrides: readonly BuiltinSpecOverride[],
): BuiltinSpec[] {
	const generatedById = new Map(
		generatedSpecs.map((spec) => [spec.id, spec] as const),
	);
	const overriddenIds = new Set<string>();
	const mergedOverrides = overrides.map((override) => {
		overriddenIds.add(override.id);
		return mergeBuiltinSpec(generatedById.get(override.id), override);
	});
	const generatedOnlySpecs = generatedSpecs.filter(
		(spec) => !overriddenIds.has(spec.id),
	);

	return [...mergedOverrides, ...generatedOnlySpecs].map((spec) => {
		const transcription = (
			BUILTIN_TRANSCRIPTION_TRANSPORTS as Readonly<
				Record<
					string,
					{ transport: GatewayProviderMetadata["transcriptionTransport"] }
				>
			>
		)[spec.id];
		return {
			...spec,
			modelOperationCapabilities:
				spec.modelOperationCapabilities ??
				BUILTIN_MODEL_OPERATION_CAPABILITIES[spec.id],
			metadata: transcription
				? {
						...spec.metadata,
						transcriptionTransport: transcription.transport,
					}
				: spec.metadata,
		};
	});
}

function generatedModels(providerId: string): Record<string, ModelInfo> {
	return cloneModels(getGeneratedModelsForProvider(providerId));
}

function firstGeneratedModelId(providerId: string): string {
	// Use the catalog's authored order, not release-date order. The cline-pass
	// block mirrors the recommended-models endpoint, which lists the intended
	// default subscription model first — the newest model is not necessarily a
	// safe default.
	const generatedModelList = Object.keys(
		getGeneratedModelsForProvider(providerId),
	);
	if (!generatedModelList.length) {
		return "";
	}
	return generatedModelList[0];
}

function pickAnthropicModel(match: (id: string) => boolean): ModelInfo {
	const entry = Object.entries(generatedModels("anthropic")).find(([id]) =>
		match(id),
	);
	if (entry) {
		return entry[1];
	}
	return {
		id: "sonnet",
		name: "Claude Sonnet",
		capabilities: ["streaming", "reasoning"],
	};
}

function buildClaudeCodeModels(): Record<string, ModelInfo> {
	function toClaudeCodeModel(id: "opus" | "sonnet" | "haiku"): ModelInfo {
		const source =
			id === "opus"
				? pickAnthropicModel((modelId) => modelId.includes("opus"))
				: id === "haiku"
					? pickAnthropicModel((modelId) => modelId.includes("haiku"))
					: pickAnthropicModel((modelId) => modelId.includes("sonnet"));
		return {
			...source,
			id,
			name: `Claude ${id.charAt(0).toUpperCase()}${id.slice(1)}`,
		};
	}

	return {
		opus: toClaudeCodeModel("opus"),
		sonnet: toClaudeCodeModel("sonnet"),
		haiku: toClaudeCodeModel("haiku"),
	};
}

function buildOpenAICodexModels(): Record<string, ModelInfo> {
	return filterOpenAICodexModels(generatedModels("openai-native"));
}

// Vercel-only model ids surfaced for the Cline provider while the OpenRouter
// catalog lacks them (Cline's backend routes these to Vercel AI Gateway).
// Remove an id once the OpenRouter catalog lists it.
const VERCEL_ONLY_CLINE_MODEL_IDS: readonly string[] = [
	"meta/muse-spark-1.2-contributor",
];

function buildElevenLabsModels(): Record<string, ModelInfo> {
	return {
		scribe_v2: {
			id: "scribe_v2",
			name: "Scribe v2",
			description:
				"ElevenLabs speech recognition model for accurate multilingual transcription",
			family: "elevenlabs",
			operation: "transcription",
			operationModes: ["batch"],
			modalities: {
				input: ["audio"],
				output: ["text"],
			},
		},
	};
}

function buildClineModels(): Record<string, ModelInfo> {
	// Cline is OpenRouter-backed generally, but its recommended-model endpoint
	// can return Vercel-style ids. Include those exact ids so runtime metadata
	// resolves without adding duplicate OpenRouter aliases to the picker.
	const vercelAliasModels = Object.fromEntries(
		Object.entries(generatedModels("vercel-ai-gateway")).filter(
			([modelId]) =>
				isCanonicalModelIdForAliasRules(
					modelId,
					VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES,
				) || VERCEL_ONLY_CLINE_MODEL_IDS.includes(modelId),
		),
	);
	const models = preferCanonicalModelIds(
		{
			...generatedModels("openrouter"),
			...vercelAliasModels,
		},
		VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES,
	);

	// Cline's inference backend currently rejects image-output models. Keep
	// those models in their native OpenRouter and Vercel catalogs.
	return filterImageOutputModels(models);
}

function buildVertexModels(): Record<string, ModelInfo> {
	const vertexModels = generatedModels("vertex");

	// models.dev does not carry Fable 5 under google-vertex, so overlay the
	// record here until it does. Pricing is deliberately dropped: Vertex
	// bills region-dependently (its US/EU multi-region rates exceed
	// Anthropic's list price), and a copied universal price would understate
	// the displayed and recorded cost. Omitting it degrades cost display to
	// "unknown" instead of wrong.
	if (vertexModels["claude-fable-5"]) {
		// Upstream now carries the model — its record wins.
		return vertexModels;
	}
	const anthropicFable = generatedModels("anthropic")["claude-fable-5"];
	if (!anthropicFable) {
		return vertexModels;
	}
	const { pricing: _droppedAnthropicPricing, ...vertexFable } = anthropicFable;
	return {
		...vertexModels,
		"claude-fable-5": vertexFable,
	};
}

function fallbackModelInfo(id: string, spec?: BuiltinSpec): ModelInfo {
	const info: ModelInfo = {
		id,
		name: id,
	};
	if (spec?.family === "openai-compatible") {
		info.contextWindow = 128_000;
		info.maxInputTokens = 128_000;
		info.capabilities = ["streaming", "tools", "images"];
	}
	if (spec?.id === "qwen" || spec?.id === "qwen-code") {
		info.family = "qwen";
		info.capabilities = ["prompt-cache"];
	}
	return info;
}

function modelInfoToGateway(
	providerId: string,
	info: ModelInfo,
): GatewayModelDefinition {
	const metadata: Record<string, JsonValue | undefined> = {};
	if (info.family) {
		metadata.family = info.family;
	}
	if (info.pricing) {
		metadata.pricing = info.pricing;
	}
	if (info.status) {
		metadata.status = info.status;
	}
	if (info.releaseDate) {
		metadata.releaseDate = info.releaseDate;
	}
	if (typeof info.metadata?.reasoningDefaultOn === "boolean") {
		metadata.reasoningDefaultOn = info.metadata.reasoningDefaultOn;
	}
	return {
		id: info.id,
		name: info.name ?? info.id,
		providerId,
		description: info.description,
		contextWindow: info.contextWindow,
		maxInputTokens: info.maxInputTokens,
		maxOutputTokens: info.maxTokens,
		operation: info.operation,
		operationModes: info.operationModes,
		modalities: info.modalities,
		capabilities: toGatewayModelCapabilities(info.capabilities),
		reasoningOptions: info.reasoningOptions,
		metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
	};
}

function inferProtocol(spec: BuiltinSpec): ProviderProtocol {
	if (spec.client === "openai") {
		return "openai-responses";
	}
	switch (spec.family) {
		case "openai":
			return "openai-responses";
		case "anthropic":
		case "bedrock":
			return "anthropic";
		case "google":
		case "vertex":
			return "gemini";
		default:
			return "openai-chat";
	}
}

function inferClient(spec: BuiltinSpec): ProviderClient {
	if (spec.protocol === "openai-responses") {
		return "openai";
	}
	switch (spec.family) {
		case "openai":
			return "openai";
		case "anthropic":
			return "anthropic";
		case "google":
			return "gemini";
		case "vertex":
			return "vertex";
		case "bedrock":
			return "bedrock";
		case "mistral":
		case "claude-code":
		case "openai-codex":
		case "opencode":
		case "dify":
		case "ollama":
		case "sap-ai-core":
			return "ai-sdk-community";
		default:
			return "openai-compatible";
	}
}

function createClineLikeSpec(
	input: Pick<BuiltinSpec, "id" | "name" | "defaultModelId"> & {
		family?: ProviderFamily;
	} & Partial<
			Pick<
				BuiltinSpec,
				| "description"
				| "popular"
				| "modelsProviderId"
				| "modelsFactory"
				| "metadata"
				| "defaults"
			>
		>,
): BuiltinSpec {
	return {
		id: input.id,
		name: input.name,
		description: input.description ?? "Cline API endpoint",
		family: input.family ?? "openai-compatible",
		popular: input.popular,
		modelToolCapabilities: NATIVE_WEB_SEARCH_MODEL_TOOL_CAPABILITIES,
		capabilities: ["reasoning", "prompt-cache", "tools", "oauth"],
		modelsProviderId: input.modelsProviderId,
		modelsFactory: input.modelsFactory,
		defaultModelId: input.defaultModelId,
		apiKeyEnv: ["CLINE_API_KEY"],
		defaults: {
			get baseUrl(): string {
				return `${getClineEnvironmentConfig().apiBaseUrl}/api/v1`;
			},
			...input.defaults,
		},
		metadata: {
			...ANTHROPIC_AND_QWEN_CACHE_ROUTING_METADATA,
			imageTransport: "openrouter",
			responseEnvelope: "success-data",
			...input.metadata,
		},
	};
}

async function handleClineResponseError(
	response: Response,
	providerId: string,
): Promise<void> {
	if (response.status < 400) {
		return;
	}

	const body = await response
		.clone()
		.text()
		.catch(() => "");

	if (isClineOrgIndividualInferenceSubscriptionMessage(body)) {
		throw new ClineOrgIndividualInferenceSubscriptionError(providerId);
	}

	if (isClineFreeModelLimitMessage(body)) {
		throw new ClineFreeModelLimitError(body, providerId);
	}

	const clinePassLimitMessage = extractClinePassLimitMessage(body);
	if (clinePassLimitMessage) {
		throw new ClinePassLimitError(clinePassLimitMessage, providerId);
	}

	if (isClineNotSubscribedMessage(body)) {
		throw new ClineNotSubscribedError(providerId);
	}
}

const cline = createClineLikeSpec({
	id: "cline",
	family: "cline",
	name: "Cline Usage-Billing",
	popular: 1,
	modelsFactory: buildClineModels,
	defaultModelId: CLINE_DEFAULT_MODEL_ID,
	defaults: {
		options: {
			onResponseError: async (response: Response) => {
				await handleClineResponseError(response, "cline");
			},
		},
	},
});

const clinePass = createClineLikeSpec({
	id: CLINE_PASS_PROVIDER_ID,
	family: "cline",
	name: "ClinePass",
	popular: 2,
	description: "Cline API endpoint with ClinePass models",
	modelsProviderId: CLINE_PASS_PROVIDER_ID,
	defaultModelId: firstGeneratedModelId(CLINE_PASS_PROVIDER_ID),
	metadata: { usageCostDisplay: "subscription" },
	defaults: {
		options: {
			onResponseError: async (response: Response) => {
				await handleClineResponseError(response, CLINE_PASS_PROVIDER_ID);
			},
		},
	},
});

/**
 * Handwritten providers plus generated providers that require Cline-specific
 * runtime or product policy. Providers fully described by models.dev must not
 * be duplicated here.
 */
const OPENAI_COMPATIBLE_SPEC_OVERRIDES: BuiltinSpecOverride[] = [
	{
		id: "openai-compatible",
		name: "OpenAI Compatible",
		description: "OpenAI-compatible chat completions endpoint",
		family: "openai-compatible",
		popular: 35,
		capabilities: ["tools"],
		defaultModelId: "gpt-4o",
		apiKeyEnv: ["OPENAI_API_KEY"],
		defaults: { baseUrl: "https://api.openai.com/v1" },
	},
	cline,
	clinePass,
	{
		id: "deepseek",
		name: "DeepSeek",
		description: "Advanced AI models with reasoning capabilities",
		family: "openai-compatible",
		popular: 10,
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "deepseek-v4-flash",
		apiKeyEnv: ["DEEPSEEK_API_KEY"],
		defaults: { baseUrl: "https://api.deepseek.com/v1" },
	},
	{
		id: "xai",
		name: "xAI",
		description: "Creator of Grok AI assistant",
		family: "openai-compatible",
		capabilities: ["reasoning"],
		defaultModelId: "grok-4.20-0309-non-reasoning",
		apiKeyEnv: ["XAI_API_KEY"],
		defaults: { baseUrl: "https://api.x.ai/v1" },
	},
	{
		id: "together",
		name: "Together AI",
		description: "Fast inference for open-source models",
		family: "openai-compatible",
		capabilities: ["reasoning"],
		defaultModelId: "Qwen/Qwen3.5-397B-A17B",
		apiKeyEnv: ["TOGETHER_API_KEY"],
		defaults: { baseUrl: "https://api.together.xyz/v1" },
	},
	{
		id: "groq",
		name: "Groq",
		description: "Ultra-fast LPU inference",
		family: "openai-compatible",
		defaultModelId: "moonshotai/kimi-k2-instruct-0905",
		apiKeyEnv: ["GROQ_API_KEY"],
		defaults: { baseUrl: "https://api.groq.com/openai/v1" },
	},
	{
		id: "cerebras",
		name: "Cerebras",
		description: "Fast inference on Cerebras wafer-scale chips",
		family: "openai-compatible",
		defaultModelId: "zai-glm-4.7",
		apiKeyEnv: ["CEREBRAS_API_KEY"],
		defaults: { baseUrl: "https://api.cerebras.ai/v1" },
	},
	{
		id: "sambanova",
		name: "SambaNova",
		description: "High-performance AI inference",
		family: "openai-compatible",
		apiKeyEnv: ["SAMBANOVA_API_KEY"],
		modelsProviderId: "sambanova",
		defaults: { baseUrl: "https://api.sambanova.ai/v1" },
	},
	{
		id: "litellm",
		name: "LiteLLM",
		description: "Self-hosted LLM proxy",
		// No `protocol` override: LiteLLM's OpenAI-compatible surface is Chat
		// Completions (`/chat/completions`), and self-hosted proxies commonly
		// do not expose `/responses`. Inherit the family default (openai-chat)
		// like every other openai-compatible built-in. See #10781 / #13003.
		family: "openai-compatible",
		popular: 40,
		capabilities: ["prompt-cache"],
		defaultModelId: "gpt-5.4",
		apiKeyEnv: ["LITELLM_API_KEY"],
		defaults: { baseUrl: "http://localhost:4000/v1" },
	},
	{
		id: "vercel-ai-gateway",
		name: "Vercel AI Gateway",
		description: "Vercel's AI gateway service",
		family: "openai-compatible",
		capabilities: ["reasoning"],
		defaultModelId: "alibaba/qwen3.6-plus",
		apiKeyEnv: ["AI_GATEWAY_API_KEY"],
		modelsProviderId: "vercel-ai-gateway",
		defaults: { baseUrl: "https://ai-gateway.vercel.sh/v1" },
		metadata: ANTHROPIC_AND_QWEN_CACHE_ROUTING_METADATA,
	},
	{
		id: "v0",
		name: "Vercel V0",
		description:
			"The Vercel provider gives you access to the v0 API, designed for building modern web applications.",
		family: "openai-compatible",
		capabilities: ["reasoning", "tools"],
		defaultModelId: "v0-1.5-md",
		apiKeyEnv: ["V0_API_KEY"],
		modelsProviderId: "v0",
		defaults: { baseUrl: "https://api.v0.dev/v1" },
	},
	{
		id: "aihubmix",
		name: "AI Hub Mix",
		description: "AI model aggregator",
		family: "openai-compatible",
		defaultModelId: "gpt-4o",
		apiKeyEnv: ["AIHUBMIX_API_KEY"],
		modelsProviderId: "aihubmix",
		defaults: { baseUrl: "https://api.aihubmix.com/v1" },
		metadata: ANTHROPIC_ROUTING_METADATA,
	},
	{
		id: "hicap",
		name: "HiCap",
		description: "HiCap AI platform",
		family: "openai-compatible",
		defaultModelId: "hicap-pro",
		apiKeyEnv: ["HICAP_API_KEY"],
		defaults: { baseUrl: "https://api.hicap.ai/v1" },
	},
	{
		id: "nousResearch",
		name: "Nous Research",
		description: "Open-source AI research lab",
		family: "openai-compatible",
		defaultModelId: "DeepHermes-3-Llama-3-3-70B-Preview",
		apiKeyEnv: ["NOUS_RESEARCH_API_KEY", "NOUSRESEARCH_API_KEY"],
		modelsProviderId: "nousResearch",
		defaults: { baseUrl: "https://inference-api.nousresearch.com/v1" },
	},
	{
		id: "huawei-cloud-maas",
		name: "Huawei Cloud MaaS",
		description: "Huawei's model-as-a-service platform",
		family: "openai-compatible",
		defaultModelId: "DeepSeek-R1",
		apiKeyEnv: ["HUAWEI_CLOUD_MAAS_API_KEY"],
		defaults: {
			baseUrl: "https://infer-modelarts.cn-southwest-2.myhuaweicloud.com/v1",
		},
	},
	{
		id: "qwen",
		name: "Alibaba Qwen",
		description: "Alibaba Qwen platform models",
		family: "openai-compatible",
		capabilities: ["tools", "reasoning"],
		defaultModelId: "qwen-plus-latest",
		apiKeyEnv: ["QWEN_API_KEY"],
		modelsProviderId: "qwen",
		defaults: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
		apiLineBaseUrls: QWEN_API_LINE_BASE_URLS,
		configFields: QWEN_CONFIG_FIELDS,
		metadata: QWEN_CACHE_ROUTING_METADATA,
	},
	{
		id: "qwen-code",
		name: "Alibaba Qwen Code",
		description: "Qwen OAuth coding models",
		family: "openai-compatible",
		capabilities: ["tools", "reasoning"],
		defaultModelId: "qwen3-coder-plus",
		modelsProviderId: "qwen-code",
		defaults: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
		apiLineBaseUrls: QWEN_API_LINE_BASE_URLS,
		configFields: QWEN_CONFIG_FIELDS,
		metadata: QWEN_CACHE_ROUTING_METADATA,
	},
	{
		// Fully described by models.dev except for the regional endpoint
		// routing policy (`apiLineBaseUrls`), which is Cline-specific.
		id: "moonshot",
		apiLineBaseUrls: {
			china: "https://api.moonshot.cn/v1",
			international: "https://api.moonshot.ai/v1",
		},
	},
	{
		id: "doubao",
		name: "Doubao",
		description: "Volcengine Ark platform models",
		family: "openai-compatible",
		capabilities: ["tools"],
		defaultModelId: "doubao-1-5-pro-256k-250115",
		apiKeyEnv: ["DOUBAO_API_KEY"],
		modelsProviderId: "doubao",
		defaults: { baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
	},
	{
		id: "zai",
		name: "Z.AI",
		description: "Z.AI's family of LLMs",
		family: "openai-compatible",
		capabilities: ["reasoning"],
		defaultModelId: "glm-5v-turbo",
		apiKeyEnv: ["ZHIPU_API_KEY"],
		modelsProviderId: "zai",
		defaults: { baseUrl: "https://api.z.ai/api/paas/v4" },
		apiLineBaseUrls: {
			china: "https://open.bigmodel.cn/api/paas/v4",
			international: "https://api.z.ai/api/paas/v4",
		},
		metadata: GLM_THINKING_ROUTING_METADATA,
	},
	{
		id: "zai-coding-plan",
		name: "Z.AI Coding Plan",
		description: "Z.AI's coding-focused models",
		family: "openai-compatible",
		capabilities: ["reasoning", "tools"],
		defaultModelId: "glm-5.2",
		apiKeyEnv: ["ZHIPU_API_KEY"],
		modelsProviderId: "zai-coding-plan",
		defaults: { baseUrl: "https://api.z.ai/api/coding/paas/v4" },
		apiLineBaseUrls: {
			china: "https://open.bigmodel.cn/api/coding/paas/v4",
			international: "https://api.z.ai/api/coding/paas/v4",
		},
		metadata: GLM_THINKING_ROUTING_METADATA,
	},
	{
		id: "kilo",
		name: "Kilo Gateway",
		description: "Kilo Gateway",
		family: "openai-compatible",
		protocol: "openai-responses",
		capabilities: ["prompt-cache", "reasoning", "tools"],
		defaultModelId: "gpt-4o",
		apiKeyEnv: ["KILO_GATEWAY_API_KEY"],
		modelsProviderId: "kilo",
		defaults: { baseUrl: "https://api.kilo.ai/api/gateway" },
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "OpenRouter AI platform",
		family: "openai-compatible",
		popular: 20,
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "anthropic/claude-sonnet-5",
		apiKeyEnv: ["OPENROUTER_API_KEY"],
		modelsProviderId: "openrouter",
		docsUrl: "https://openrouter.ai/models",
		defaults: { baseUrl: "https://openrouter.ai/api/v1" },
		metadata: {
			...ANTHROPIC_AND_QWEN_CACHE_ROUTING_METADATA,
			...OPENROUTER_STICKY_SESSION_METADATA,
			imageTransport: "openrouter",
		},
	},
	{
		id: "ollama",
		name: "Ollama",
		description: "Ollama Cloud and local LLM hosting",
		// Routed to the native Ollama API vendor (`vendors/ollama.ts`), not the
		// OpenAI-compatible `/v1` endpoint: `/v1` ignores `options.num_ctx`, so
		// models would always load with Ollama's 4096-token server default.
		family: "ollama",
		popular: 25,
		capabilities: ["tools"],
		defaultModelId: "",
		apiKeyEnv: ["OLLAMA_API_KEY"],
		// Local Ollama models are discovered dynamically; do not inherit the
		// generated Ollama Cloud catalog when merging the models.dev spec.
		modelsFactory: () => ({}),
		defaults: { baseUrl: "http://localhost:11434" },
		modelsSourceUrl: "http://localhost:11434/api/tags",
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		description: "Local model inference with LM Studio",
		family: "openai-compatible",
		defaultModelId: "",
		apiKeyEnv: ["LMSTUDIO_API_KEY"],
		modelsProviderId: "lmstudio",
		defaults: { baseUrl: "http://localhost:1234/v1" },
		modelsSourceUrl: "http://localhost:1234/v1/models",
	},
	{
		id: "oca",
		name: "Oracle Code Assist",
		description: "Oracle Code Assist (OCA) LiteLLM gateway",
		family: "openai-compatible",
		capabilities: ["reasoning", "prompt-cache", "tools"],
		defaultModelId: "anthropic/claude-3-7-sonnet-20250219",
		apiKeyEnv: ["OCA_API_KEY"],
		modelsProviderId: "oca",
		defaults: { baseUrl: DEFAULT_EXTERNAL_OCA_BASE_URL },
		configFields: OCA_CONFIG_FIELDS,
		metadata: ANTHROPIC_ROUTING_METADATA,
	},
	{
		id: "asksage",
		name: "AskSage",
		description: "AskSage platform",
		family: "openai-compatible",
		client: "fetch",
		capabilities: ["tools"],
		defaultModelId: "gpt-4o",
		apiKeyEnv: ["ASKSAGE_API_KEY"],
		modelsFactory: () => ({}),
		defaults: { baseUrl: "https://api.asksage.ai/server" },
	},
];

/**
 * Non-OpenAI-compatible runtime/product overrides. Keep generated catalog facts
 * in providers.generated.ts and only retain Cline-owned behavior here.
 */
const BUILTIN_SPEC_OVERRIDES: BuiltinSpecOverride[] = [
	{
		id: "openai-native",
		name: "OpenAI",
		description: "Creator of GPT and ChatGPT",
		family: "openai",
		modelToolCapabilities: OPENAI_NATIVE_MODEL_TOOL_CAPABILITIES,
		capabilities: ["reasoning"],
		modelsProviderId: "openai-native",
		defaultModelId: "gpt-5.4",
		apiKeyEnv: ["OPENAI_API_KEY"],
		defaults: { baseUrl: "https://api.openai.com/v1" },
	},
	{
		id: "openai-codex",
		name: "OpenAI ChatGPT Subscription",
		description:
			"OpenAI ChatGPT subscription access uses an OAuth device code flow.",
		family: "openai",
		modelToolCapabilities: NATIVE_WEB_SEARCH_MODEL_TOOL_CAPABILITIES,
		popular: 5,
		capabilities: ["reasoning", "oauth"],
		defaultModelId: OPENAI_CODEX_DEFAULT_MODEL_ID,
		modelsFactory: buildOpenAICodexModels,
		defaults: { baseUrl: "https://chatgpt.com/backend-api/codex" },
		configFields: [],
		metadata: { usageCostDisplay: "subscription" },
	},
	{
		id: "openai-codex-cli",
		name: "OpenAI Codex CLI",
		description: "OpenAI Codex via the local Codex CLI provider",
		family: "openai-codex",
		capabilities: ["reasoning", "provider-tools", "local-auth"],
		defaultModelId: "gpt-5.6-sol",
		modelsProviderId: "openai",
		executable: "codex",
		docsUrl: "https://developers.openai.com/codex/cli",
		defaults: { baseUrl: "https://chatgpt.com/backend-api/codex" },
		configFields: [],
		metadata: { usageCostDisplay: "subscription" },
	},
	{
		id: "elevenlabs",
		name: "ElevenLabs",
		description: "ElevenLabs speech-to-text and audio services",
		family: "openai-compatible",
		client: "fetch",
		defaultModelId: "scribe_v2",
		apiKeyEnv: ["ELEVENLABS_API_KEY"],
		modelsFactory: buildElevenLabsModels,
		docsUrl: "https://elevenlabs.io/docs/overview/capabilities/speech-to-text",
		defaults: { baseUrl: "https://api.elevenlabs.io/v1" },
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Creator of Claude, the AI assistant",
		family: "anthropic",
		modelToolCapabilities: NATIVE_WEB_SEARCH_MODEL_TOOL_CAPABILITIES,
		popular: 15,
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "claude-sonnet-5",
		apiKeyEnv: ["ANTHROPIC_API_KEY"],
		modelsProviderId: "anthropic",
		defaults: { baseUrl: "https://api.anthropic.com/v1" },
		metadata: ANTHROPIC_ROUTING_METADATA,
	},
	{
		id: "claude-code",
		name: "Claude Code",
		description: "Use Claude Code SDK with Claude Pro/Max subscription",
		family: "claude-code",
		// provider-tools: the Claude Code CLI executes its own native tools
		// (Read/Write/Bash/...) inside the spawned agent session and cannot
		// bridge externally-executed AI SDK tools. Without this capability the
		// gateway sends Cline's tool definitions (which the provider drops)
		// while the CLI's own tools stay enabled with no approval plumbing —
		// every write is refused and no prompt can appear (#13146).
		// local-auth: the spawned CLI authenticates from its own credential
		// store (the Claude Pro/Max subscription login), so no API key is
		// read from provider settings. Without this capability configure UIs
		// ask for a key and readiness checks refuse a keyless entry.
		capabilities: ["reasoning", "provider-tools", "local-auth"],
		defaultModelId: "sonnet",
		modelsFactory: buildClaudeCodeModels,
		executable: "claude",
		docsUrl: "https://code.claude.com/docs/en/setup",
		defaults: { baseUrl: "" },
		configFields: [],
		// Claude Code is typically authenticated with a Pro/Max subscription,
		// where any dollar figure would be an API-rate estimate rather than a
		// real charge. The CLI does report a cost when it runs on API-key
		// billing, but the provider cannot tell the two apart from here, so
		// prefer not showing a number over showing a misleading one.
		metadata: { usageCostDisplay: "subscription" },
	},
	{
		id: "gemini",
		name: "Google Gemini",
		description: "Google Gemini API",
		family: "google",
		modelToolCapabilities: NATIVE_WEB_SEARCH_MODEL_TOOL_CAPABILITIES,
		popular: 45,
		capabilities: ["reasoning", "prompt-cache"],
		apiKeyEnv: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
		modelsProviderId: "gemini",
		defaults: { baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
	},
	{
		id: "vertex",
		name: "Google Vertex AI",
		description: "Google Cloud Vertex AI",
		family: "vertex",
		modelToolCapabilities: VERTEX_MODEL_TOOL_CAPABILITIES,
		capabilities: ["reasoning", "prompt-cache"],
		apiKeyEnv: [
			"GCP_PROJECT_ID",
			"GOOGLE_CLOUD_PROJECT",
			"GOOGLE_APPLICATION_CREDENTIALS",
			"GEMINI_API_KEY",
			"GOOGLE_API_KEY",
			"GOOGLE_VERTEX_PROJECT",
			"GOOGLE_VERTEX_LOCATION",
		],
		modelsFactory: buildVertexModels,
		configFields: VERTEX_CONFIG_FIELDS,
		metadata: ANTHROPIC_ROUTING_METADATA,
	},
	{
		id: "bedrock",
		name: "AWS Bedrock",
		description: "Amazon Bedrock managed foundation models",
		family: "bedrock",
		popular: 30,
		capabilities: ["reasoning", "prompt-cache"],
		defaultModelId: "minimax.minimax-m2.5",
		apiKeyEnv: [
			"AWS_BEARER_TOKEN_BEDROCK",
			"AWS_REGION",
			"AWS_ACCESS_KEY_ID",
			"AWS_SECRET_ACCESS_KEY",
			"AWS_SESSION_TOKEN",
		],
		modelsProviderId: "bedrock",
		configFields: BEDROCK_CONFIG_FIELDS,
		metadata: BEDROCK_ROUTING_METADATA,
	},
	{
		id: "mistral",
		// models.dev does not currently publish Mistral's API base URL.
		defaults: { baseUrl: "https://api.mistral.ai/v1" },
	},
	{
		id: "minimax",
		apiLineBaseUrls: {
			china: "https://api.minimaxi.com/anthropic/v1",
			international: "https://api.minimax.io/anthropic/v1",
		},
		metadata: MINIMAX_THINKING_ROUTING_METADATA,
	},
	{
		id: "opencode",
		name: "OpenCode",
		description: "OpenCode SDK multi-provider runtime",
		family: "opencode",
		capabilities: ["reasoning", "oauth"],
		defaultModelId: "openai/gpt-5.6-sol",
		modelsProviderId: "opencode",
		defaults: { baseUrl: "" },
		configFields: [],
	},
	{
		id: "dify",
		name: "Dify",
		description: "Dify workflow/application provider via AI SDK",
		family: "dify",
		defaultModelId: "default",
		apiKeyEnv: ["DIFY_API_KEY"],
		modelsFactory: () => ({}),
	},
	{
		id: "sapaicore",
		name: "SAP AI Core",
		description: "SAP AI Core inference and orchestration platform",
		family: "sap-ai-core",
		client: "ai-sdk-community",
		capabilities: ["tools", "reasoning", "prompt-cache"],
		defaultModelId: "anthropic--claude-3.5-sonnet",
		apiKeyEnv: ["AICORE_SERVICE_KEY", "VCAP_SERVICES"],
		modelsProviderId: "sapaicore",
		metadata: ANTHROPIC_ROUTING_METADATA,
	},
	...OPENAI_COMPATIBLE_SPEC_OVERRIDES,
];

export const BUILTIN_SPECS: BuiltinSpec[] = mergeBuiltinSpecs(
	GENERATED_PROVIDER_SPECS,
	BUILTIN_SPEC_OVERRIDES,
);

const API_LINE_BASE_URLS_BY_PROVIDER_ID: ReadonlyMap<
	string,
	Readonly<Partial<Record<ProviderApiLine, string>>>
> = new Map(
	BUILTIN_SPECS.flatMap((spec) =>
		spec.apiLineBaseUrls ? [[spec.id, spec.apiLineBaseUrls] as const] : [],
	),
);

export function isProviderApiLine(value: unknown): value is ProviderApiLine {
	return value === "china" || value === "international";
}

/**
 * Resolve the regional base URL for a provider's selected API line (e.g.
 * Qwen/Moonshot/Z.AI/MiniMax "china" vs "international" endpoints). Returns
 * undefined when the provider has no regional endpoints or the api line is
 * not a recognized value. Callers must let an explicit user-configured base
 * URL win over this resolution.
 */
export function resolveProviderApiLineBaseUrl(
	providerId: string,
	apiLine: unknown,
): string | undefined {
	if (!isProviderApiLine(apiLine)) {
		return undefined;
	}
	return API_LINE_BASE_URLS_BY_PROVIDER_ID.get(
		normalizeProviderId(providerId),
	)?.[apiLine];
}

function getModels(spec: BuiltinSpec): Record<string, ModelInfo> {
	if (spec.modelsFactory) {
		return spec.modelsFactory();
	}
	if (spec.modelsProviderId) {
		return generatedModels(spec.modelsProviderId);
	}
	return {};
}

function toModelCollection(spec: BuiltinSpec): ModelCollection {
	const sourceModels = getModels(spec);
	const capabilities = getProviderCapabilities(spec);
	const metadata = getProviderMetadata(spec);
	const models: Record<string, ModelInfo> =
		Object.keys(sourceModels).length > 0
			? { ...sourceModels }
			: spec.defaultModelId
				? {
						[spec.defaultModelId]: fallbackModelInfo(spec.defaultModelId, spec),
					}
				: {};
	if (spec.defaultModelId && !models[spec.defaultModelId]) {
		models[spec.defaultModelId] = fallbackModelInfo(spec.defaultModelId, spec);
	}
	const modelIds = Object.keys(models);
	const defaultModelId = spec.defaultModelId || modelIds[0] || "default";

	return {
		provider: {
			id: spec.id,
			name: spec.name,
			description: spec.description,
			protocol: spec.protocol ?? inferProtocol(spec),
			baseUrl: spec.defaults?.baseUrl,
			modelsSourceUrl: spec.modelsSourceUrl,
			docsUrl: spec.docsUrl,
			executable: spec.executable,
			defaultModelId,
			capabilities,
			env: spec.apiKeyEnv ? [...spec.apiKeyEnv] : undefined,
			client: spec.client ?? inferClient(spec),
			source: "system",
			metadata,
		},
		models,
	};
}

export function toManifest(spec: BuiltinSpec): GatewayProviderManifest {
	const collection = toModelCollection(spec);
	const capabilities = getProviderCapabilities(spec);
	const metadata = getProviderMetadata(spec);
	const models = Object.values(collection.models).map((info) =>
		modelInfoToGateway(spec.id, info),
	);
	const resolvedModels =
		models.length > 0
			? models
			: [
					// A placeholder for a provider whose collection is empty. Nothing
					// is known about the model, so leave capabilities absent rather
					// than claiming text-only: gateway gates read an absent list as
					// "unspecified" and fail open, while `["text"]` would read as an
					// authoritative denial of images and reasoning.
					modelInfoToGateway(spec.id, {
						id: collection.provider.defaultModelId || "default",
						name: collection.provider.defaultModelId || "Default",
					}),
				];

	return {
		id: spec.id,
		name: spec.name,
		description: spec.description,
		defaultModelId:
			collection.provider.defaultModelId || resolvedModels[0]?.id || "default",
		models: resolvedModels,
		modelOperationCapabilities: spec.modelOperationCapabilities?.map(
			(capability: GatewayModelOperationCapability) => ({
				...capability,
				modes: capability.modes ? [...capability.modes] : undefined,
				inputModalities: capability.inputModalities
					? [...capability.inputModalities]
					: undefined,
				outputModalities: capability.outputModalities
					? [...capability.outputModalities]
					: undefined,
				routes: capability.routes?.map((route) => ({ ...route })),
				excludeRoutes: capability.excludeRoutes?.map((route) => ({ ...route })),
			}),
		),
		modelToolCapabilities: spec.modelToolCapabilities?.map((capability) => ({
			...capability,
			routes: capability.routes?.map((route) => ({ ...route })),
			excludeRoutes: capability.excludeRoutes?.map((route) => ({ ...route })),
		})),
		capabilities,
		env: spec.env ?? ["browser", "node"],
		api: spec.defaults?.baseUrl,
		apiKeyEnv: spec.apiKeyEnv,
		docsUrl: spec.docsUrl,
		metadata,
	};
}

/** Static manifests used for synchronous capability checks before providers load. */
export const BUILTIN_PROVIDER_MANIFESTS_BY_ID: Readonly<
	Record<string, GatewayProviderManifest>
> = Object.fromEntries(
	BUILTIN_SPECS.map((spec) => [spec.id, toManifest(spec)] as const),
);

export const BUILTIN_PROVIDER_COLLECTION_LIST: ModelCollection[] =
	BUILTIN_SPECS.map(toModelCollection);

export const BUILTIN_PROVIDER_COLLECTIONS_BY_ID: Record<
	string,
	ModelCollection
> = Object.fromEntries(
	BUILTIN_PROVIDER_COLLECTION_LIST.map((collection) => [
		collection.provider.id,
		collection,
	]),
);
