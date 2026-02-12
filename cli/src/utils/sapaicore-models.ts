/**
 * Utility module for fetching SAP AI Core models and deployments
 * Handles both orchestration mode (static models) and direct deployment mode (dynamic fetching)
 *
 * Reference commits: d7b3a5253, c1e3ac860, ea8a7fd7d, f7fe2b854, e7edd2f7c, 973660a57
 */

import { sapAiCoreModels } from "@shared/api"
import axios from "axios"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { getAxiosSettings } from "@/shared/net"

/**
 * Configuration required for SAP AI Core API authentication
 */
export interface SapAiCoreCredentials {
	clientId: string
	clientSecret: string
	baseUrl: string
	tokenUrl: string
	resourceGroup?: string
}

/**
 * Represents a model item in the model picker
 */
export interface SapAiCoreModelItem {
	id: string
	label: string
	deploymentId?: string
	isDeployed: boolean
	section: "deployed" | "available"
}

/**
 * Represents a deployment from the SAP AI Core API
 */
interface Deployment {
	id: string
	modelName: string
	modelVersion: string
}

/**
 * OAuth token response
 */
interface Token {
	access_token: string
	expires_in: number
	scope: string
	jti: string
	token_type: string
	expires_at: number
}

// Token cache for reuse
let cachedToken: Token | undefined

/**
 * Authenticate with SAP AI Core and get an access token
 */
async function authenticate(credentials: SapAiCoreCredentials): Promise<Token> {
	const payload = {
		grant_type: "client_credentials",
		client_id: credentials.clientId,
		client_secret: credentials.clientSecret,
	}

	const externalHeaders = buildExternalBasicHeaders()
	const tokenUrl = credentials.tokenUrl.replace(/\/+$/, "") + "/oauth/token"
	const response = await axios.post(tokenUrl, payload, {
		headers: { ...externalHeaders, "Content-Type": "application/x-www-form-urlencoded" },
		...getAxiosSettings(),
	})
	const token = response.data as Token
	token.expires_at = Date.now() + token.expires_in * 1000
	return token
}

/**
 * Get a valid access token (cached or fresh)
 */
async function getToken(credentials: SapAiCoreCredentials): Promise<string> {
	if (!cachedToken || cachedToken.expires_at < Date.now()) {
		cachedToken = await authenticate(credentials)
	}
	return cachedToken.access_token
}

/**
 * Fetch deployments from SAP AI Core API
 * Filters to only RUNNING deployments
 *
 * Reference: commit f7fe2b854
 */
async function fetchDeployments(credentials: SapAiCoreCredentials): Promise<Deployment[]> {
	const token = await getToken(credentials)
	const externalHeaders = buildExternalBasicHeaders()
	const headers = {
		...externalHeaders,
		Authorization: `Bearer ${token}`,
		"AI-Resource-Group": credentials.resourceGroup || "default",
		"Content-Type": "application/json",
		"AI-Client-Type": "Cline",
	}

	const url = `${credentials.baseUrl}/v2/lm/deployments?$top=10000&$skip=0`

	const response = await axios.get(url, { headers, ...getAxiosSettings() })
	const deployments = response.data.resources

	return deployments
		.filter((deployment: any) => deployment.targetStatus === "RUNNING")
		.map((deployment: any) => {
			const model = deployment.details?.resources?.backend_details?.model
			if (!model?.name || !model?.version) {
				return null
			}
			return {
				id: deployment.id,
				modelName: model.name,
				modelVersion: model.version,
			}
		})
		.filter((deployment: Deployment | null): deployment is Deployment => deployment !== null)
}

/**
 * Get static models from sapAiCoreModels
 */
function getStaticModelIds(): string[] {
	return Object.keys(sapAiCoreModels)
}

/**
 * Match a deployment to a static model
 * Returns the matching static model ID if found
 */
function matchDeploymentToStaticModel(deployment: Deployment): string | undefined {
	const staticModels = getStaticModelIds()
	const deploymentName = deployment.modelName.toLowerCase()

	// Try exact match first
	const exactMatch = staticModels.find((m) => m.toLowerCase() === deploymentName)
	if (exactMatch) {
		return exactMatch
	}

	// Try prefix match (e.g., "gpt-4o" matches deployment "gpt-4o")
	const prefixMatch = staticModels.find((m) => {
		const modelBase = m.split(":")[0].toLowerCase()
		return modelBase === deploymentName
	})
	if (prefixMatch) {
		return prefixMatch
	}

	return undefined
}

/**
 * Get models for SAP AI Core
 * In orchestration mode: returns static models only
 * In direct deployment mode: fetches deployments and merges with static models
 *
 * Reference commits: d7b3a5253, c1e3ac860, ea8a7fd7d
 */
export async function getSapAiCoreModels(
	credentials: SapAiCoreCredentials | null,
	useOrchestrationMode: boolean,
): Promise<{
	models: SapAiCoreModelItem[]
	error: string | null
}> {
	const staticModels = getStaticModelIds()

	// Orchestration mode: return static models only (no API call needed)
	// Reference: commit d7b3a5253
	if (useOrchestrationMode || !credentials) {
		return {
			models: staticModels.map((id) => ({
				id,
				label: id,
				isDeployed: true, // Orchestration handles routing
				section: "deployed" as const,
			})),
			error: null,
		}
	}

	// Direct deployment mode: fetch deployments and merge with static models
	// Reference commits: c1e3ac860, ea8a7fd7d
	try {
		const deployments = await fetchDeployments(credentials)

		// Build a map of deployed models with their deployment IDs
		const deployedModelMap = new Map<string, Deployment>()
		for (const deployment of deployments) {
			const matchedModel = matchDeploymentToStaticModel(deployment)
			if (matchedModel && !deployedModelMap.has(matchedModel)) {
				deployedModelMap.set(matchedModel, deployment)
			}
		}

		// Create model items: deployed models first, then non-deployed
		const deployedModels: SapAiCoreModelItem[] = []
		const availableModels: SapAiCoreModelItem[] = []

		for (const modelId of staticModels) {
			const deployment = deployedModelMap.get(modelId)
			if (deployment) {
				deployedModels.push({
					id: modelId,
					label: `${modelId} (deployed)`,
					deploymentId: deployment.id,
					isDeployed: true,
					section: "deployed",
				})
			} else {
				availableModels.push({
					id: modelId,
					label: modelId,
					isDeployed: false,
					section: "available",
				})
			}
		}

		// Return deployed first, then available
		// Reference: commit ea8a7fd7d
		return {
			models: [...deployedModels, ...availableModels],
			error: null,
		}
	} catch (error) {
		// Error handling with fallback to static models
		// Reference: commit e7edd2f7c
		const errorMessage = error instanceof Error ? error.message : String(error)
		return {
			models: staticModels.map((id) => ({
				id,
				label: id,
				isDeployed: false,
				section: "available" as const,
			})),
			error: `Failed to fetch deployments: ${errorMessage}`,
		}
	}
}

/**
 * Find deployment ID for a given model
 * Used when user selects a model to persist the deployment ID
 *
 * Reference: commit 973660a57
 */
export function findDeploymentIdForModel(models: SapAiCoreModelItem[], modelId: string): string | undefined {
	const model = models.find((m) => m.id === modelId)
	return model?.deploymentId
}

/**
 * Clear the cached token (useful when credentials change)
 */
export function clearTokenCache(): void {
	cachedToken = undefined
}
