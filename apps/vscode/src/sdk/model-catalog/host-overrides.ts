/**
 * Applies the `ModelInfo` fields the extension owns locally, on top of
 * an adapted SDK `ModelInfo`. Today this is just Vertex's
 * `supportsGlobalEndpoint` allowlist (see `./vertex-global-endpoint.ts`).
 *
 * Both the model-list resolution path (`resolveSdkModels`) and the
 * single-model lookup path (`resolveModelInfo`) pass adapted
 * `ModelInfo` through this function so the same UX guard rails apply
 * regardless of which RPC the webview uses. When the SDK adopts these
 * flags upstream, the override and this file can be removed together.
 */

import type { ModelInfo } from "@shared/api"
import type { ProviderId } from "./contracts"
import { vertexModelSupportsGlobalEndpoint } from "./vertex-global-endpoint"

export function applyHostModelInfoOverrides(providerId: ProviderId, modelId: string, modelInfo: ModelInfo): ModelInfo {
	if (providerId === "vertex" && vertexModelSupportsGlobalEndpoint(providerId, modelId)) {
		return { ...modelInfo, supportsGlobalEndpoint: true }
	}
	return modelInfo
}
