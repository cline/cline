/**
 * OpenAI Codex (ChatGPT Plus/Pro subscription) model catalog.
 *
 * Single source of truth: the `@cline/llms` SDK. The SDK's
 * {@link filterOpenAICodexModels} produces the canonical Codex allowlist by
 * filtering the generated `openai-native` catalog, and the SDK's builtin
 * provider registry exposes the canonical default model id.
 *
 * The SDK reports real per-token pricing for these models. The Codex
 * subscription bills per ChatGPT Plus/Pro plan rather than per token, so
 * `OpenAiCodexProvider.tsx` passes `hideUsageCost` to {@link ModelInfoView}
 * to suppress the price strip in the settings UI. The runtime handler
 * separately hard-codes `totalCost: 0` in
 * {@link OpenAiCodexHandler.normalizeUsage}, so users never see a charge
 * either way; the SDK pricing is just informational metadata.
 */

import { getProviderCollectionSync } from "@cline/llms"
// Relative path: this module is imported by both the extension and
// webview-ui builds, which carry different `@/*` path mappings. A
// relative import resolves the same way in both contexts.
import { adaptSdkModelInfo } from "../sdk/model-catalog/shape-adapter"
import type { ModelInfo } from "./api"

const CODEX_PROVIDER_ID = "openai-codex"

function buildCodexCatalog(): {
	models: Record<string, ModelInfo>
	defaultModelId: string
} {
	const collection = getProviderCollectionSync(CODEX_PROVIDER_ID)
	if (!collection) {
		// SDK has no Codex provider registered. In production the SDK
		// always carries it; this branch is reachable today only under
		// the test stubs in `apps/vscode/src/test/requires.ts` and
		// `apps/vscode/test-setup.js`, which return undefined. Surface
		// an empty catalog so callers see "nothing to offer" rather
		// than a fabricated value.
		return { models: {}, defaultModelId: "" }
	}

	const models: Record<string, ModelInfo> = {}
	for (const info of Object.values(collection.models)) {
		models[info.id] = adaptSdkModelInfo(info)
	}

	return { models, defaultModelId: collection.provider.defaultModelId }
}

const { models: CODEX_MODELS, defaultModelId: CODEX_DEFAULT_MODEL_ID } = buildCodexCatalog()

/**
 * Canonical OpenAI Codex model catalog, derived from the `@cline/llms` SDK.
 *
 * Keys are SDK model ids (e.g. `"gpt-5.4"`, `"gpt-5.3-codex"`). The set of
 * keys is determined by {@link filterOpenAICodexModels} in the SDK.
 */
export const openAiCodexModels: Record<string, ModelInfo> = CODEX_MODELS

/**
 * Default Codex model id, sourced from the SDK's builtin provider metadata.
 */
export const openAiCodexDefaultModelId: string = CODEX_DEFAULT_MODEL_ID

/**
 * OpenAI Codex model id. Plain `string` because the SDK provides Codex
 * model ids as opaque strings. Use {@link openAiCodexModels} for
 * membership checks.
 */
export type OpenAiCodexModelId = string
