// Maps the extension's legacy SAP AI Core ApiConfiguration onto the SDK's
// structured SAP provider options (baseUrl + sap block).
//
// buildSessionConfig() uses this to hand the SDK runtime the same structured
// SAP fields that the legacy UI stores in ApiConfiguration.

import type { ProviderSettings } from "@cline/core"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"

export type SapProviderConfig = Pick<ProviderSettings, "baseUrl" | "sap">

function trimString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined
	}

	let trimmed = value.trim()
	// Strip leading and trailing double quotes
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		trimmed = trimmed.slice(1, -1).trim()
	}
	// Strip leading and trailing single quotes
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		trimmed = trimmed.slice(1, -1).trim()
	}
	return trimmed
}

export function buildSapProviderConfig(config: ApiConfiguration, mode: Mode): SapProviderConfig {
	const sap: NonNullable<SapProviderConfig["sap"]> = {}
	let baseUrl = trimString(config.sapAiCoreBaseUrl)
	if (baseUrl) {
		baseUrl = baseUrl.replace(/\/+$/, "")
		if (baseUrl.endsWith("/v2")) {
			baseUrl = baseUrl.slice(0, -3).replace(/\/+$/, "")
		}
	}
	const useOrchestrationMode = config.sapAiCoreUseOrchestrationMode ?? true
	const rawDeploymentId = mode === "plan" ? config.planModeSapAiCoreDeploymentId : config.actModeSapAiCoreDeploymentId
	const deploymentId = trimString(rawDeploymentId) || undefined
	const sapFields = {
		clientId: trimString(config.sapAiCoreClientId),
		clientSecret: trimString(config.sapAiCoreClientSecret),
		tokenUrl: trimString(config.sapAiCoreTokenUrl),
		resourceGroup: trimString(config.sapAiResourceGroup),
		deploymentId,
	}

	for (const [key, value] of Object.entries(sapFields)) {
		if (value !== undefined) {
			sap[key as keyof typeof sapFields] = value
		}
	}

	if (Object.keys(sap).length > 0) {
		sap.useOrchestrationMode = useOrchestrationMode
	}

	return {
		...(baseUrl !== undefined ? { baseUrl } : {}),
		...(Object.keys(sap).length > 0 ? { sap } : {}),
	}
}
