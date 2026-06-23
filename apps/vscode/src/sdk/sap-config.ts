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

	return value.trim()
}

export function buildSapProviderConfig(config: ApiConfiguration, mode: Mode): SapProviderConfig {
	const sap: NonNullable<SapProviderConfig["sap"]> = {}
	const baseUrl = trimString(config.sapAiCoreBaseUrl)
	const deploymentId = trimString(mode === "plan" ? config.planModeSapAiCoreDeploymentId : config.actModeSapAiCoreDeploymentId)
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

	if (Object.keys(sap).length > 0 && config.sapAiCoreUseOrchestrationMode !== undefined) {
		sap.useOrchestrationMode = config.sapAiCoreUseOrchestrationMode
	}

	return {
		...(baseUrl !== undefined ? { baseUrl } : {}),
		...(Object.keys(sap).length > 0 ? { sap } : {}),
	}
}
