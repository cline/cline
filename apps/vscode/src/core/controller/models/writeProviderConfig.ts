import type { ProviderConfigPatch } from "@/sdk/model-catalog/contracts"
import { areProviderIdsEquivalent } from "@/shared/model-catalog/provider-helpers"
import { getRemoteLockedProviderFieldPaths } from "@/shared/model-catalog/remote-config-locks"
import { ProviderConfigResponse, WriteProviderConfigRequest } from "@/shared/proto/cline/models"
import {
	type ProviderCatalogController,
	parseProviderIdRequest,
	toProviderConfigPatch,
	toRedactedProviderConfigResponse,
} from "./providerCatalogShared"

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined
}

function readMode(value: unknown): ProviderConfigPatch["mode"] {
	return value === "plan" || value === "act" ? value : undefined
}

function readHeaders(value: unknown): Readonly<Record<string, string>> | undefined {
	if (!isRecord(value)) {
		return undefined
	}
	const headers: Record<string, string> = {}
	for (const [key, headerValue] of Object.entries(value)) {
		if (typeof headerValue !== "string") {
			return undefined
		}
		headers[key] = headerValue
	}
	return headers
}

function stripInternalSettings(settings: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(settings).filter(([key]) => !key.startsWith("__")))
}

function isSettingsObjectEmpty(settings: Record<string, unknown>): boolean {
	return Object.keys(stripInternalSettings(settings)).length === 0
}

function toSettingsProviderConfigPatch(settings: Record<string, unknown>): ProviderConfigPatch {
	const mode = readMode(settings.__mode)
	const providerSettings = stripInternalSettings(settings)
	const aws = isRecord(providerSettings.aws) ? providerSettings.aws : undefined
	const gcp = isRecord(providerSettings.gcp) ? providerSettings.gcp : undefined
	const azure = isRecord(providerSettings.azure) ? providerSettings.azure : undefined
	const sap = isRecord(providerSettings.sap) ? providerSettings.sap : undefined
	const oca = isRecord(providerSettings.oca) ? providerSettings.oca : undefined
	const auth = isRecord(providerSettings.auth) ? providerSettings.auth : undefined
	const reasoning = isRecord(providerSettings.reasoning) ? providerSettings.reasoning : undefined

	return {
		...(mode ? { mode } : {}),
		settings: providerSettings,
		...(providerSettings.apiKey !== undefined ? { apiKey: readString(providerSettings.apiKey) ?? null } : {}),
		...(providerSettings.baseUrl !== undefined ? { baseUrl: readString(providerSettings.baseUrl) ?? null } : {}),
		...(providerSettings.apiLine !== undefined ? { apiLine: readString(providerSettings.apiLine) ?? null } : {}),
		...(providerSettings.region !== undefined ? { region: readString(providerSettings.region) ?? null } : {}),
		...(providerSettings.headers !== undefined ? { headers: readHeaders(providerSettings.headers) ?? null } : {}),
		...(aws
			? {
					aws: {
						...(aws.accessKey !== undefined ? { accessKey: readString(aws.accessKey) } : {}),
						...(aws.secretKey !== undefined ? { secretKey: readString(aws.secretKey) } : {}),
						...(aws.sessionToken !== undefined ? { sessionToken: readString(aws.sessionToken) } : {}),
						...(aws.region !== undefined ? { region: readString(aws.region) } : {}),
						...(aws.authentication !== undefined ? { authentication: readString(aws.authentication) } : {}),
						...(aws.profile !== undefined ? { profile: readString(aws.profile) } : {}),
						...(aws.usePromptCache !== undefined ? { usePromptCache: readBoolean(aws.usePromptCache) } : {}),
						...(aws.endpoint !== undefined ? { endpoint: readString(aws.endpoint) } : {}),
						...(aws.customModelBaseId !== undefined ? { customModelBaseId: readString(aws.customModelBaseId) } : {}),
						...(aws.useCrossRegionInference !== undefined
							? { useCrossRegionInference: readBoolean(aws.useCrossRegionInference) }
							: {}),
						...(aws.useGlobalInference !== undefined
							? { useGlobalInference: readBoolean(aws.useGlobalInference) }
							: {}),
					},
				}
			: {}),
		...(gcp
			? {
					gcp: {
						...(gcp.projectId !== undefined ? { projectId: readString(gcp.projectId) } : {}),
						...(gcp.region !== undefined ? { region: readString(gcp.region) } : {}),
					},
				}
			: {}),
		...(azure
			? {
					azure: {
						...(azure.apiVersion !== undefined ? { apiVersion: readString(azure.apiVersion) } : {}),
					},
				}
			: {}),
		...(sap
			? {
					sap: {
						...(sap.clientId !== undefined ? { clientId: readString(sap.clientId) } : {}),
						...(sap.clientSecret !== undefined ? { clientSecret: readString(sap.clientSecret) } : {}),
						...(sap.tokenUrl !== undefined ? { tokenUrl: readString(sap.tokenUrl) } : {}),
						...(sap.resourceGroup !== undefined ? { resourceGroup: readString(sap.resourceGroup) } : {}),
						...(sap.deploymentId !== undefined ? { deploymentId: readString(sap.deploymentId) } : {}),
						...(sap.useOrchestrationMode !== undefined
							? { useOrchestrationMode: readBoolean(sap.useOrchestrationMode) }
							: {}),
						...(sap.api !== undefined ? { api: readString(sap.api) } : {}),
						...(isRecord(sap.defaultSettings) ? { defaultSettings: sap.defaultSettings } : {}),
					},
				}
			: {}),
		...(oca
			? {
					oca: {
						...(oca.mode !== undefined ? { mode: readString(oca.mode) } : {}),
						...(oca.usePromptCache !== undefined ? { usePromptCache: readBoolean(oca.usePromptCache) } : {}),
					},
				}
			: {}),
		...(auth
			? {
					auth: {
						accessToken: readString(auth.accessToken),
						refreshToken: readString(auth.refreshToken),
						accountId: readString(auth.accountId),
					},
				}
			: {}),
		...(reasoning
			? {
					reasoning: {
						enabled: readBoolean(reasoning.enabled),
						effort: readString(reasoning.effort),
						budgetTokens: readNumber(reasoning.budgetTokens),
					},
				}
			: {}),
		...(isRecord(providerSettings.extras) ? { extras: providerSettings.extras } : {}),
	}
}

function deletePath(settings: Record<string, unknown>, path: string): void {
	const segments = path.split(".").filter(Boolean)
	if (segments.length === 0) {
		return
	}

	const parents: Array<[Record<string, unknown>, string]> = []
	let cursor: Record<string, unknown> = settings
	for (const segment of segments.slice(0, -1)) {
		const next = cursor[segment]
		if (!isRecord(next)) {
			return
		}
		parents.push([cursor, segment])
		cursor = next
	}

	delete cursor[segments[segments.length - 1]]
	for (const [parent, segment] of parents.reverse()) {
		const child = parent[segment]
		if (isRecord(child) && Object.keys(child).length === 0) {
			delete parent[segment]
		}
	}
}

type RemoteConfigController = ProviderCatalogController & {
	stateManager?: {
		getRemoteConfigSettings?: () => unknown
	}
}

function stripLockedSettings(
	controller: ProviderCatalogController,
	providerId: string,
	settings: Record<string, unknown>,
): Record<string, unknown> {
	const remoteConfigSettings = (controller as RemoteConfigController).stateManager?.getRemoteConfigSettings?.()
	if (!isRecord(remoteConfigSettings)) {
		return settings
	}

	const lockedPaths = getRemoteLockedProviderFieldPaths(remoteConfigSettings, providerId)
	if (lockedPaths.size === 0) {
		return settings
	}

	const next = structuredClone(settings) as Record<string, unknown>
	for (const path of lockedPaths) {
		deletePath(next, path)
	}
	return next
}

function pickAdvertisedSettingsPaths(
	settings: Record<string, unknown>,
	allowedPaths: ReadonlySet<string>,
	parentPath = "",
): Record<string, unknown> {
	const next: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(settings)) {
		if (key.startsWith("__")) {
			next[key] = value
			continue
		}

		const path = parentPath ? `${parentPath}.${key}` : key
		if (allowedPaths.has(path)) {
			next[key] = value
			continue
		}

		if (!isRecord(value)) {
			continue
		}

		const hasAllowedChildPath = [...allowedPaths].some((allowedPath) => allowedPath.startsWith(`${path}.`))
		if (!hasAllowedChildPath) {
			continue
		}

		const child = pickAdvertisedSettingsPaths(value, allowedPaths, path)
		if (Object.keys(child).length > 0) {
			next[key] = child
		}
	}
	return next
}

async function stripUnadvertisedSettings(
	controller: ProviderCatalogController,
	providerId: string,
	settings: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const listing = (await controller.getProviderCatalog().listProviders()).find((provider) =>
		areProviderIdsEquivalent(provider.id, providerId),
	)
	const allowedPaths = new Set(listing?.configFields?.map((field) => field.path) ?? [])
	if (allowedPaths.size === 0) {
		return Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith("__")))
	}
	return pickAdvertisedSettingsPaths(settings, allowedPaths)
}

async function providerAdvertisesFieldPath(
	controller: ProviderCatalogController,
	providerId: string,
	path: string,
): Promise<boolean> {
	const listing = (await controller.getProviderCatalog().listProviders()).find((provider) =>
		areProviderIdsEquivalent(provider.id, providerId),
	)
	return listing?.configFields?.some((field) => field.path === path) === true
}

async function stripUnsafeDirectPatch(
	controller: ProviderCatalogController,
	providerId: string,
	patch: ProviderConfigPatch,
): Promise<ProviderConfigPatch> {
	const { auth: _auth, ...next } = patch
	if ("headers" in next && !(await providerAdvertisesFieldPath(controller, providerId, "headers"))) {
		const { headers: _headers, ...withoutHeaders } = next
		return withoutHeaders
	}
	return next
}

export async function writeProviderConfig(
	controller: ProviderCatalogController,
	request: WriteProviderConfigRequest,
): Promise<ProviderConfigResponse> {
	const providerId = parseProviderIdRequest(request.providerId)
	const store = controller.getProviderConfigStore()
	const settingsJson = request.patch?.settingsJson?.trim()
	if (settingsJson) {
		const parsed = JSON.parse(settingsJson) as unknown
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("settings_json must be a JSON object")
		}
		const advertisedSettings = await stripUnadvertisedSettings(controller, providerId, parsed as Record<string, unknown>)
		const settings = stripLockedSettings(controller, providerId, advertisedSettings)
		if (isSettingsObjectEmpty(settings)) {
			return toRedactedProviderConfigResponse(store.read(providerId), store)
		}
		const updated = store.write(providerId, toSettingsProviderConfigPatch(settings))
		return toRedactedProviderConfigResponse(updated, store)
	}
	const updated = store.write(
		providerId,
		await stripUnsafeDirectPatch(controller, providerId, toProviderConfigPatch(request.patch)),
	)
	return toRedactedProviderConfigResponse(updated, store)
}
