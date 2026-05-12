import { ApiHandler } from "@core/api"
import { OpenAiHandler } from "@core/api/providers/openai"

/**
 * MacM4LocalAgent tier context-window sizes. Pinned to the actual
 * num_ctx values configured in `config/litellm-config.yaml` and the
 * Qwen2.5/Qwen3 Modelfiles:
 *
 *   - local-fast  -> MLX serves Qwen2.5-Coder-7B with 32K positions
 *                    but Cline-shaped traffic is functionally bounded
 *                    by the model's effective 16K ceiling
 *   - local-long  -> Ollama serves Qwen3-Coder-Next-80B with
 *                    `num_ctx 131072` (the TurboQuant tq3 budget)
 *
 * Local models start to degrade noticeably before the hard window
 * limit, so we use tighter truncation thresholds than the cloud tiers:
 *   - local-fast: keep 3K tokens free (vs 27K-40K for cloud)
 *   - local-long: keep ~40K tokens free (truncate at ~70% saturation)
 *
 * Why values are smaller than cloud buffers: the local degradation
 * pattern is graceful (quality drops, model still answers) whereas
 * cloud rejections are hard 400 errors. Leaving 40K free on a 131K
 * window means the model has practical room for one or two long
 * tool results without forcing an early truncation.
 */
const MACM4_LOCAL_FAST_CONTEXT = 16_384
const MACM4_LOCAL_LONG_CONTEXT = 131_072

/**
 * Detect MacM4-style models by id when we don't have direct
 * provider-type info. Used to recognise MacM4 traffic flowing through
 * the generic openai-compatible handler.
 */
function isMacM4LocalFastModelId(modelId: string): boolean {
	const id = modelId.toLowerCase()
	const stripped = id.startsWith("gpt-") ? id.slice(4) : id
	return stripped === "local-fast" || stripped === "macm4-local-fast"
}

function isMacM4LocalLongModelId(modelId: string): boolean {
	const id = modelId.toLowerCase()
	const stripped = id.startsWith("gpt-") ? id.slice(4) : id
	return (
		stripped === "local-long" ||
		stripped === "local-agent" ||
		stripped.startsWith("local-coder-") ||
		stripped === "macm4-local-long" ||
		stripped === "hybrid-auto" // worst case: hybrid lands on local-long
	)
}

/**
 * Gets context window information for the given API handler
 *
 * @param api The API handler to get context window information for
 * @returns An object containing the raw context window size and the effective max allowed size
 */
export function getContextWindowInfo(api: ApiHandler) {
	const model = api.getModel()
	const modelId = (model.id ?? "").toLowerCase()
	let contextWindow = model.info.contextWindow || 128_000
	// FIXME: hack to get anyone using openai compatible with deepseek to have the proper context window instead of the default 128k. We need a way for the user to specify the context window for models they input through openai compatible

	// Handle special cases like DeepSeek
	if (api instanceof OpenAiHandler && modelId.includes("deepseek")) {
		contextWindow = 128_000
	}

	// MacM4LocalAgent tier coercion. When users configure Cline to talk
	// to the LiteLLM proxy via the openai-compatible provider, the
	// reported contextWindow defaults to 128K -- which is wrong for both
	// local tiers (local-fast actually has 16K; local-long has 131K).
	// Coerce based on the canonical model id so truncation kicks in at
	// the correct fraction of the real window.
	if (isMacM4LocalFastModelId(modelId)) {
		contextWindow = MACM4_LOCAL_FAST_CONTEXT
	} else if (isMacM4LocalLongModelId(modelId)) {
		contextWindow = MACM4_LOCAL_LONG_CONTEXT
	}

	let maxAllowedSize: number
	switch (contextWindow) {
		case MACM4_LOCAL_FAST_CONTEXT: // MacM4 local-fast (MLX Qwen2.5-Coder)
			// Keep 3K free for a single tool turn's output budget.
			maxAllowedSize = contextWindow - 3_000
			break
		case MACM4_LOCAL_LONG_CONTEXT: // MacM4 local-long (Ollama Qwen3-Coder-Next 80B)
			// Truncate at ~70% saturation. Local models start degrading
			// before the hard limit, so we trigger earlier than the
			// cloud tiers do.
			maxAllowedSize = Math.floor(contextWindow * 0.7) // ~91,750
			break
		case 64_000: // deepseek models
			maxAllowedSize = contextWindow - 27_000
			break
		case 128_000: // most models
			maxAllowedSize = contextWindow - 30_000
			break
		case 200_000: // claude models
			maxAllowedSize = contextWindow - 40_000
			break
		default:
			maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8) // for deepseek, 80% of 64k meant only ~10k buffer which was too small and resulted in users getting context window errors.
	}

	return { contextWindow, maxAllowedSize }
}
