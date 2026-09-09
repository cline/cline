import type { RemoteConfigBundle, RemoteConfigManagedInstructionFile } from "@cline/shared"
import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import { ClineEnv } from "@/config"
import { AuthService } from "@/services/auth/AuthService"
import { buildBasicClineHeaders } from "@/services/EnvUtils"
import { CLINE_API_ENDPOINT } from "@/shared/cline/api"
import { getAxiosSettings } from "@/shared/net"
import { APIKeySchema, type APIKeySettings, type RemoteConfig, RemoteConfigSchema } from "@/shared/remote-config/schema"
import { Logger } from "@/shared/services/Logger"
import type { ConfiguredAPIKeys } from "@/shared/storage/state-keys"
import { deleteRemoteConfigFromCache, readRemoteConfigFromCache, writeRemoteConfigToCache } from "../disk"
import { parseRemoteConfigDiscovery, parseRemoteConfigValue } from "./contracts"
import { isRemoteConfigEnabled } from "./utils"

export interface SdkRemoteConfigControlPlaneController {
	accountService: {
		switchAccount(organizationId: string): Promise<unknown>
		fetchUserRemoteConfig(): Promise<import("@/shared/ClineAccount").UserRemoteConfigDiscoveryResponse | null | undefined>
	}
	stateManager: {
		setSecret(key: "remoteLiteLlmApiKey", value: string | undefined): unknown
		getGlobalStateKey(key: "remoteRulesToggles" | "remoteWorkflowToggles" | "remoteSkillsToggles"): Record<string, boolean>
		getGlobalStateKey(key: "lastManagedOrganizationId"): string | undefined
	}
}

interface RemoteConfigControlPlaneFetchInput {
	workspacePath: string
	rootPath?: string
	context?: unknown
	logger?: unknown
	signal?: AbortSignal
	now?: number
}

export type SdkRemoteConfigBundle = RemoteConfigBundle

function parseApiKeys(value: string): APIKeySettings {
	try {
		if (!value) {
			return {}
		}
		return APIKeySchema.parse(JSON.parse(value))
	} catch (err) {
		Logger.error("Failed to parse providers api keys", err)
		return {}
	}
}

async function makeAuthenticatedRequest<T>(endpoint: string, organizationId: string): Promise<T> {
	const authService = AuthService.getInstance()
	const authToken = await authService.getAuthToken()
	if (!authToken) {
		throw new Error("No Cline account auth token found")
	}

	const apiEndpoint = endpoint.replace("{id}", organizationId)
	const url = new URL(apiEndpoint, ClineEnv.config().apiBaseUrl).toString()
	const requestConfig: AxiosRequestConfig = {
		headers: {
			Authorization: `Bearer ${authToken}`,
			"Content-Type": "application/json",
			...(await buildBasicClineHeaders()),
		},
		...getAxiosSettings(),
	}

	const response: AxiosResponse<{ data?: T; error: string; success: boolean }> = await axios.request({
		url,
		method: "GET",
		...requestConfig,
	})

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Request to ${apiEndpoint} failed with status ${response.status}`)
	}
	if (!response.data || !response.data.success) {
		throw new Error(`API error: ${response.data?.error || "Unknown error"}`)
	}
	if (!response.data.data) {
		throw new Error(`No data returned from ${apiEndpoint}`)
	}
	return response.data.data
}

async function fetchRemoteConfigForOrganization(organizationId: string): Promise<RemoteConfig | undefined> {
	try {
		const configData = await makeAuthenticatedRequest<{ value: string; enabled: boolean }>(
			CLINE_API_ENDPOINT.REMOTE_CONFIG,
			organizationId,
		)
		if (!configData.enabled) {
			await deleteRemoteConfigFromCache(organizationId)
			return undefined
		}
		return parseRemoteConfigValue(configData.value)
	} catch (error) {
		Logger.error(`Failed to fetch remote config for organization ${organizationId}:`, error)
		const cachedConfig = await readRemoteConfigFromCache(organizationId)
		if (cachedConfig) {
			try {
				return RemoteConfigSchema.parse(cachedConfig)
			} catch (validationError) {
				Logger.error(`Cached config validation failed for organization ${organizationId}:`, validationError)
			}
		}
		// A transient failure with no usable cache must NOT be reported as "no
		// config" — the caller would clear the org's policy and report success.
		// Rethrow so the refresh preserves the last known-good state instead.
		throw error
	}
}

async function fetchApiKeysForOrganization(organizationId: string): Promise<APIKeySettings> {
	try {
		const response = await makeAuthenticatedRequest<{ providerApiKeys: string }>(CLINE_API_ENDPOINT.API_KEYS, organizationId)
		return parseApiKeys(response?.providerApiKeys)
	} catch (error) {
		Logger.error(`Failed to fetch API keys for organization ${organizationId}:`, error)
		return {}
	}
}

function parseDiscoveredConfig(value: string, organizationId: string): RemoteConfig | undefined {
	try {
		return parseRemoteConfigValue(value)
	} catch (error) {
		Logger.warn(`Failed to parse discovered config for org ${organizationId}, will re-fetch`, error)
		return undefined
	}
}

function skillsToManagedInstructions(remoteConfig: RemoteConfig): RemoteConfigManagedInstructionFile[] {
	return (remoteConfig.globalSkills ?? []).map((skill, index) => ({
		id: `remote-config:skill:${index}:${skill.name}`,
		name: skill.name,
		kind: "skill",
		contents: skill.contents,
		alwaysEnabled: skill.alwaysEnabled,
	}))
}

function isInstructionEnabled(entry: { name: string; alwaysEnabled?: boolean }, toggles: Record<string, boolean>): boolean {
	return Boolean(entry.alwaysEnabled) || toggles[entry.name] !== false
}

export class SdkRemoteConfigControlPlane {
	readonly name = "cline-extension-remote-config"
	private lastConfiguredKeys: ConfiguredAPIKeys = {}
	private lastRemoteConfig: RemoteConfig | undefined
	private remoteConfigAvailable = false
	private explicitNoConfig = false

	constructor(private readonly controller: SdkRemoteConfigControlPlaneController) {}

	getLastConfiguredKeys(): ConfiguredAPIKeys {
		return this.lastConfiguredKeys
	}

	getLastRemoteConfig(): RemoteConfig | undefined {
		return this.lastRemoteConfig
	}

	wasExplicitNoConfig(): boolean {
		return this.explicitNoConfig
	}

	isRemoteConfigAvailable(): boolean {
		return this.remoteConfigAvailable
	}

	async fetchBundle(_input: RemoteConfigControlPlaneFetchInput): Promise<SdkRemoteConfigBundle | undefined> {
		this.explicitNoConfig = false
		this.lastConfiguredKeys = {}
		this.lastRemoteConfig = undefined
		this.remoteConfigAvailable = false

		const discovered = await this.discoverRemoteConfigOrg()
		if (!discovered) {
			this.explicitNoConfig = true
			return undefined
		}

		const { organizationId, discoveredValue } = discovered
		const remoteConfig = await this.resolveRemoteConfig(organizationId, discoveredValue)
		this.remoteConfigAvailable = Boolean(remoteConfig)
		if (!remoteConfig || !isRemoteConfigEnabled(organizationId)) {
			this.explicitNoConfig = true
			return undefined
		}

		const authService = AuthService.getInstance()
		if (authService.getActiveOrganizationId() !== organizationId) {
			await this.controller.accountService.switchAccount(organizationId)
		}

		this.lastConfiguredKeys = await this.configureRemoteApiKeys(organizationId, remoteConfig)
		await writeRemoteConfigToCache(organizationId, remoteConfig)
		this.lastRemoteConfig = remoteConfig

		const ruleToggles = this.controller.stateManager.getGlobalStateKey("remoteRulesToggles") || {}
		const workflowToggles = this.controller.stateManager.getGlobalStateKey("remoteWorkflowToggles") || {}
		const skillToggles = this.controller.stateManager.getGlobalStateKey("remoteSkillsToggles") || {}
		// Explicit host-to-SDK boundary: skills are not part of the SDK RemoteConfig
		// schema and are adapted into managedInstructions below. The assignment keeps
		// the remaining runtime config structurally checked without an unsafe cast.
		const { globalSkills: _globalSkills, ...sdkRemoteConfig } = remoteConfig
		const effectiveRemoteConfig: NonNullable<RemoteConfigBundle["remoteConfig"]> = {
			...sdkRemoteConfig,
			globalRules: remoteConfig.globalRules?.filter((entry) => isInstructionEnabled(entry, ruleToggles)),
			globalWorkflows: remoteConfig.globalWorkflows?.filter((entry) => isInstructionEnabled(entry, workflowToggles)),
		}

		return {
			source: this.name,
			version: remoteConfig.version,
			remoteConfig: effectiveRemoteConfig,
			managedInstructions: skillsToManagedInstructions(remoteConfig).filter((entry) =>
				isInstructionEnabled(entry, skillToggles),
			),
			metadata: { organizationId },
		}
	}

	private async discoverRemoteConfigOrg(): Promise<{ organizationId: string; discoveredValue?: string } | undefined> {
		const activeOrganizationId = AuthService.getInstance().getActiveOrganizationId()

		// Opt-out is a local, admin-gated preference. Evaluate it before any
		// network call so opting out clears remote config even while offline.
		if (activeOrganizationId && !isRemoteConfigEnabled(activeOrganizationId)) {
			// The org still distributes config; keep availability so the account
			// UI keeps offering the opt-in toggle to the opted-out admin.
			this.remoteConfigAvailable = true
			return undefined
		}

		const response = await this.controller.accountService.fetchUserRemoteConfig()
		if (response === undefined) {
			// No auth token was available. An active organization means the user
			// is signed in, so this is auth/network trouble (e.g. token refresh
			// failed offline), not an org without config. The persisted marker
			// covers the offline cold start where identity restore fails and BOTH
			// token and org come back null: this install last ran under org
			// policy, so reporting no-config here would wipe the policy — and the
			// marker itself — permanently disarming the fail-closed session gate.
			// A real sign-out clears the marker directly, so it never gets stuck.
			if (activeOrganizationId || this.controller.stateManager.getGlobalStateKey("lastManagedOrganizationId")) {
				throw new Error("Remote config discovery returned no response for a managed install")
			}
			return undefined
		}
		if (response === null) {
			// The server answered and distributes no remote config for this user.
			return undefined
		}

		const discovery = parseRemoteConfigDiscovery(response)
		if (activeOrganizationId) {
			return {
				organizationId: activeOrganizationId,
				discoveredValue: activeOrganizationId === discovery.organizationId ? discovery.value : undefined,
			}
		}

		if (isRemoteConfigEnabled(discovery.organizationId)) {
			return { organizationId: discovery.organizationId, discoveredValue: discovery.value }
		}

		if (discovery.organizations) {
			for (const org of discovery.organizations) {
				if (org.organizationId === discovery.organizationId) {
					continue
				}
				if (isRemoteConfigEnabled(org.organizationId)) {
					return { organizationId: org.organizationId }
				}
			}
		}

		return undefined
	}

	private async resolveRemoteConfig(organizationId: string, discoveredValue?: string): Promise<RemoteConfig | undefined> {
		if (discoveredValue) {
			const config = parseDiscoveredConfig(discoveredValue, organizationId)
			if (config) {
				return config
			}
		}
		return fetchRemoteConfigForOrganization(organizationId)
	}

	private async configureRemoteApiKeys(organizationId: string, remoteConfig: RemoteConfig): Promise<ConfiguredAPIKeys> {
		const configuredApiKeys: ConfiguredAPIKeys = {}
		const hasConfiguredProviders = remoteConfig.providerSettings && Object.keys(remoteConfig.providerSettings).length > 0
		if (hasConfiguredProviders) {
			const apiKeys = await fetchApiKeysForOrganization(organizationId)
			if (remoteConfig.providerSettings?.LiteLLM) {
				if (apiKeys.litellm) {
					configuredApiKeys.litellm = true
					this.controller.stateManager.setSecret("remoteLiteLlmApiKey", apiKeys.litellm)
				} else {
					this.controller.stateManager.setSecret("remoteLiteLlmApiKey", undefined)
				}
			} else {
				this.controller.stateManager.setSecret("remoteLiteLlmApiKey", undefined)
			}
		} else {
			this.controller.stateManager.setSecret("remoteLiteLlmApiKey", undefined)
		}
		return configuredApiKeys
	}
}
