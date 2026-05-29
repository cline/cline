import type { ApiProvider } from "@shared/api"
import { Logger } from "../../shared/services/Logger"
import type { KnownProviderId, ProviderId } from "./contracts"

/**
 * Extension-known provider ids. The object is typed against `ApiProvider`
 * so adding/removing an `ApiProvider` member forces this list to update.
 *
 * `parseProviderId` lowercases all ids, so the legacy camel-case provider
 * id `nousResearch` is represented in the runtime set as `nousresearch`.
 */
const KNOWN_API_PROVIDERS = {
	anthropic: true,
	"claude-code": true,
	openrouter: true,
	bedrock: true,
	vertex: true,
	openai: true,
	ollama: true,
	lmstudio: true,
	gemini: true,
	"openai-native": true,
	"openai-codex": true,
	requesty: true,
	together: true,
	deepseek: true,
	qwen: true,
	"qwen-code": true,
	doubao: true,
	mistral: true,
	"vscode-lm": true,
	cline: true,
	litellm: true,
	moonshot: true,
	nebius: true,
	fireworks: true,
	asksage: true,
	xai: true,
	sambanova: true,
	cerebras: true,
	sapaicore: true,
	groq: true,
	huggingface: true,
	"huawei-cloud-maas": true,
	dify: true,
	baseten: true,
	"vercel-ai-gateway": true,
	zai: true,
	oca: true,
	aihubmix: true,
	minimax: true,
	hicap: true,
	nousResearch: true,
	wandb: true,
} satisfies Record<ApiProvider, true>

const normalizeProviderId = (raw: string): string => raw.trim().toLowerCase()

const knownProviderIds = new Set(Object.keys(KNOWN_API_PROVIDERS).map(normalizeProviderId))
const warnedUnknownProviderIds = new Set<string>()

/**
 * Parse a raw string into a branded {@link ProviderId}.
 *
 * Behavior:
 * - Trims surrounding whitespace.
 * - Lowercases the id (canonical form used by the model-catalog boundary).
 * - Accepts arbitrary strings so SDK/custom providers are representable.
 * - Emits a one-time warning per non-empty unknown id per process.
 *
 * The single `as ProviderId` cast here is the constructor for the brand
 * and is the allowed boundary cast for this primitive. Do not replicate
 * this cast elsewhere; callers outside this module must obtain a
 * `ProviderId` through this function.
 */
export function parseProviderId(raw: string): ProviderId {
	const normalized = normalizeProviderId(raw)
	if (normalized.length > 0 && !knownProviderIds.has(normalized) && !warnedUnknownProviderIds.has(normalized)) {
		warnedUnknownProviderIds.add(normalized)
		Logger.warn(`[model-catalog] Unknown provider id "${normalized}". Treating as a custom provider.`)
	}
	return normalized as ProviderId
}

/**
 * Type guard narrowing a {@link ProviderId} to {@link KnownProviderId}.
 *
 * Recognition is membership in the normalized `ApiProvider` set. Because
 * `parseProviderId` lowercases input, legacy `nousResearch` is recognized
 * after parsing as `nousresearch`.
 */
export function isKnownProviderId(id: ProviderId): id is KnownProviderId {
	return knownProviderIds.has(id)
}
