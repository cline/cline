// Replaces classic src/core/api buildApiHandler (see origin/main).
//
// Builds an SDK ApiHandler (from `@cline/llms`) directly from the extension's
// legacy ApiConfiguration. This is the single inference path: the main task
// loop runs through ClineCore (see cline-session-factory.ts), and standalone
// utility callers (commit message generation) use the handler
// returned here. Both share the same provider/model/key/baseUrl resolution so
// there is no second source of truth.

import { type ApiHandler, createHandler, type ProviderConfig, resolveProviderRequestHeaders } from "@cline/llms"
import type { ApiConfiguration } from "@shared/api"
import { ClineClient } from "@shared/cline"
import { Logger } from "@shared/services/Logger"
import type { Mode } from "@shared/storage/types"
import { reasoningEffortFromThinkingBudget } from "@shared/utils/reasoning-support"
import { ExtensionRegistryInfo } from "@/registry"
import { fetch } from "@/shared/net"
import { buildBedrockProviderConfig } from "./bedrock-config"
import {
	resolveApiKey,
	resolveBaseUrl,
	resolveHostIdentity,
	resolveIsMultiRootWorkspace,
	resolveModelId,
	resolveOllamaProviderConfig,
	resolveVertexProviderConfig,
} from "./cline-session-factory"
import { toSdkProviderId } from "./model-catalog/sdk-provider-id"
import { getProviderSettingsManager } from "./provider-migration"

/**
 * Client identity for the Cline surface headers, resolved from the host (see
 * `resolveClineRequestClientContext`). Shaped like the session path's
 * `extensionContext.client` so both build the same headers.
 */
export interface ApiHandlerClientContext {
	name?: string
	version?: string
	platform?: string
	platformVersion?: string
	isMultiRoot?: boolean
}

/**
 * Surface tag for standalone requests, mirroring `SessionSource.VSCODE` in
 * `@cline/core`. Inlined rather than imported so this module stays free of a
 * core dependency it needs nothing else from.
 */
const REQUEST_HEADER_SOURCE = "vscode"

/**
 * Resolve the request headers for a standalone handler.
 *
 * Delegates to the same `resolveProviderRequestHeaders` policy the session path
 * uses (see `local-runtime-bootstrap.ts` in `@cline/core`), so the Cline surface
 * identity headers — `X-CLIENT-TYPE`, `X-CLIENT-VERSION`, `X-PLATFORM`,
 * `User-Agent`, … — are identical whether a request comes from a task or from a
 * one-shot utility caller. Without them the Cline gateway rejects requests for
 * models restricted to Cline product surfaces (free models) with HTTP 403.
 *
 * No `sessionId` is passed: a standalone handler is not a task, so `X-Task-ID`
 * is omitted rather than sent empty (the pre-SDK extension sent an empty value
 * here, so nothing server-side depends on it).
 */
function resolveRequestHeaders(
	providerId: string,
	client: ApiHandlerClientContext | undefined,
): Record<string, string> | undefined {
	return resolveProviderRequestHeaders({
		providerId,
		source: REQUEST_HEADER_SOURCE,
		defaultSource: REQUEST_HEADER_SOURCE,
		client: {
			name: client?.name ?? ClineClient.VSCode,
			version: client?.version ?? ExtensionRegistryInfo.version,
			platform: client?.platform,
			platformVersion: client?.platformVersion,
			isMultiRoot: client?.isMultiRoot,
		},
		// The extension bundles the SDK core rather than depending on a separately
		// versioned one, so its own version is the core version — the convention
		// `buildBasicClineHeaders` (EnvUtils) already uses for Cline API calls.
		coreVersion: ExtensionRegistryInfo.version,
		headers: {
			// Custom headers the user configured for this provider in
			// providers.json, layered under the required headers exactly as the
			// session path layers them.
			stored: resolveStoredProviderHeaders(providerId),
		},
	})
}

function resolveStoredProviderHeaders(providerId: string): Record<string, string> | undefined {
	try {
		return getProviderSettingsManager().getProviderSettings(providerId)?.headers
	} catch {
		Logger.warn(`[SdkApiHandler] Failed to read stored headers for ${providerId} from providers.json`)
		return undefined
	}
}

/**
 * Resolve the host's client identity for the Cline surface headers.
 *
 * Mirrors the session factory's client context so a standalone request reports
 * the same client/platform as a task from the same host (e.g. "Cline for
 * JetBrains" + IDE version when this bundle runs inside cline-core).
 */
export async function resolveClineRequestClientContext(): Promise<ApiHandlerClientContext> {
	const [hostIdentity, isMultiRoot] = await Promise.all([resolveHostIdentity(), resolveIsMultiRootWorkspace()])
	return {
		name: hostIdentity?.clineType || ClineClient.VSCode,
		version: hostIdentity?.clineVersion || ExtensionRegistryInfo.version,
		platform: hostIdentity?.platform || undefined,
		platformVersion: hostIdentity?.version || undefined,
		isMultiRoot,
	}
}

export interface BuildApiHandlerOptions {
	/**
	 * Disable extended thinking/reasoning for this handler. Standalone utility
	 * calls (commit message generation) want fast, cheap,
	 * deterministic completions and don't benefit from reasoning. When true we
	 * send `thinking: false` and omit both effort and budget so providers like
	 * OpenRouter don't receive a reasoning config at all.
	 */
	disableReasoning?: boolean
	/**
	 * Host client identity used to build the Cline surface headers. Resolving it
	 * needs an async hostbridge round-trip, so callers that can await should use
	 * `buildApiHandlerWithHostContext`; when omitted we fall back to the
	 * extension's own identity.
	 */
	client?: ApiHandlerClientContext
}

/**
 * Build an SDK `ProviderConfig` from the extension's `ApiConfiguration` for the
 * given mode (plan/act).
 *
 * Reuses the same resolvers the session factory uses to map the legacy config
 * onto provider id, model id, API key, and base URL, then converts the provider
 * id to the SDK's spelling (e.g. `openai` → `openai-compatible`).
 *
 * Reasoning handling: the SDK gateway forwards `reasoningEffort` as
 * `reasoning.effort`. Effort is the only reasoning control the extension UI
 * exposes (matching the CLI); the SDK translates it into each provider's wire
 * format, including budget-token mapping where the provider requires one.
 * Legacy thinking budgets persisted by older versions are honored by mapping
 * them onto the effort scale when no explicit effort is stored.
 */
export function buildSdkProviderConfig(
	configuration: ApiConfiguration,
	mode: Mode,
	options?: BuildApiHandlerOptions,
): ProviderConfig {
	const providerId = (mode === "plan" ? configuration.planModeApiProvider : configuration.actModeApiProvider) ?? "cline"

	const apiKey = resolveApiKey(providerId, configuration)
	const modelId = resolveModelId(providerId, mode, configuration)
	const baseUrl = resolveBaseUrl(providerId, configuration)

	const reasoningEffort = mode === "plan" ? configuration.planModeReasoningEffort : configuration.actModeReasoningEffort
	const legacyThinkingBudgetTokens =
		mode === "plan" ? configuration.planModeThinkingBudgetTokens : configuration.actModeThinkingBudgetTokens

	const vertexProviderConfig = providerId === "vertex" ? resolveVertexProviderConfig(configuration) : undefined

	const sdkProviderId = toSdkProviderId(providerId)
	const headers = resolveRequestHeaders(sdkProviderId, options?.client)

	const base: ProviderConfig = {
		providerId: sdkProviderId,
		modelId: modelId ?? "",
		apiKey: apiKey ?? "",
		baseUrl,
		...(headers ? { headers } : {}),
		...(vertexProviderConfig ?? {}),
		// Use the proxy-aware fetch so gateway providers respect corporate proxy
		// configuration (see .clinerules/network.md).
		fetch,
		// Bedrock needs its region + structured AWS auth options forwarded to the
		// SDK gateway. Without these, a pasted Bedrock API key / region is dropped.
		...(providerId === "bedrock" ? buildBedrockProviderConfig(configuration, mode) : {}),
		// Ollama carries the user's request timeout and context window
		// (`num_ctx`) on the provider config; without this, standalone callers
		// ignore an explicit Request Timeout setting and load models with
		// Ollama's 4096-token server default.
		...(providerId === "ollama" ? resolveOllamaProviderConfig(configuration, modelId) : {}),
	}

	if (options?.disableReasoning) {
		// Explicitly turn reasoning off; do not send effort or budget.
		return { ...base, thinking: false }
	}

	if (reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high" || reasoningEffort === "xhigh") {
		return { ...base, reasoningEffort }
	}
	// An explicit "none" wins over any stored legacy budget.
	if (reasoningEffort === "none") {
		return base
	}
	const budgetEffort = reasoningEffortFromThinkingBudget(legacyThinkingBudgetTokens)
	if (budgetEffort) {
		return { ...base, reasoningEffort: budgetEffort }
	}
	return base
}

/**
 * Build an SDK-backed `ApiHandler` from the extension's `ApiConfiguration`.
 *
 * This is the SDK replacement for the legacy per-provider handler factory. The
 * returned handler implements the same `createMessage`/`getModel` surface, so
 * existing callers continue to work unchanged.
 */
export function buildApiHandler(configuration: ApiConfiguration, mode: Mode, options?: BuildApiHandlerOptions): ApiHandler {
	const providerConfig = buildSdkProviderConfig(configuration, mode, options)
	const handler = createHandler(providerConfig)
	const getModel = handler.getModel.bind(handler)

	handler.getModel = () => {
		return {
			...getModel(),
			providerId: providerConfig.providerId,
		}
	}

	return handler
}

/**
 * Build an SDK-backed `ApiHandler` with the host's client identity resolved.
 *
 * Prefer this over `buildApiHandler` wherever the caller can await: resolving
 * the host identity takes a hostbridge round-trip, and without it the Cline
 * surface headers fall back to the extension's own identity.
 */
export async function buildApiHandlerWithHostContext(
	configuration: ApiConfiguration,
	mode: Mode,
	options?: BuildApiHandlerOptions,
): Promise<ApiHandler> {
	const client = options?.client ?? (await resolveClineRequestClientContext())
	return buildApiHandler(configuration, mode, { ...options, client })
}
