import axios from "axios"
import { StringArray } from "@/shared/proto/cline/common"
import { SapAiCoreModelsRequest } from "@/shared/proto/cline/models"
import { Controller } from ".."

interface Token {
	access_token: string
	expires_in: number
	scope: string
	jti: string
	token_type: string
	expires_at: number
}

/**
 * Authenticates with SAP AI Core and returns an access token
 * @param clientId SAP AI Core client ID
 * @param clientSecret SAP AI Core client secret
 * @param tokenUrl SAP AI Core token URL
 * @returns Promise<Token> Access token with metadata
 */
async function getToken(clientId: string, clientSecret: string, tokenUrl: string): Promise<Token> {
	const payload = new URLSearchParams({
		grant_type: "client_credentials",
		client_id: clientId,
		client_secret: clientSecret,
	})

	const url = tokenUrl.replace(/\/+$/, "") + "/oauth/token"
	const response = await axios.post(url, payload, {
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
	})
	const token = response.data as Token
	token.expires_at = Date.now() + token.expires_in * 1000
	return token
}

/**
 * Fetches model names from SAP AI Core deployments
 * @param accessToken Access token for authentication
 * @param baseUrl SAP AI Core base URL
 * @param resourceGroup SAP AI Core resource group
 * @returns Promise<string[]> Array of model names from running deployments
 */
async function fetchAiCoreModelNames(accessToken: string, baseUrl: string, resourceGroup: string): Promise<string[]> {
	if (!accessToken) {
		return ["ai-core-not-configured"]
	}

	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"AI-Resource-Group": resourceGroup || "default",
		"Content-Type": "application/json",
		"AI-Client-Type": "Cline",
	}

	const url = `${baseUrl}/v2/lm/deployments?$top=10000&$skip=0`

	try {
		const response = await axios.get(url, { headers })
		const deployments = response.data.resources

		return deployments
			.filter((deployment: any) => deployment.targetStatus === "RUNNING")
			.map((deployment: any) => {
				const model = deployment.details?.resources?.backend_details?.model
				if (!model?.name || !model?.version) {
					return null // Skip this row
				}
				return `${model.name}:${model.version}`
			})
			.filter((modelName: string | null) => modelName !== null)
	} catch (error) {
		console.error("Error fetching deployments:", error)
		throw new Error("Failed to fetch deployments")
	}
}

/**
 * Fetches available models from SAP AI Core deployments
 * @param controller The controller instance
 * @param request The request containing SAP AI Core configuration
 * @returns StringArray of model names
 */
export async function getSapAiCoreModels(_controller: Controller, request: SapAiCoreModelsRequest): Promise<StringArray> {
	try {
		// Check if required configuration is provided
		if (!request.clientId || !request.clientSecret || !request.baseUrl) {
			// Return empty array if configuration is incomplete
			return StringArray.create({ values: [] })
		}

		// Direct authentication and model name fetching
		const token = await getToken(request.clientId, request.clientSecret, request.tokenUrl)
		const modelNames = await fetchAiCoreModelNames(token.access_token, request.baseUrl, request.resourceGroup)

		// Extract base model names (without version) and sort
		const baseModelNames = modelNames.map((modelName) => modelName.split(":")[0].toLowerCase()).sort()

		return StringArray.create({ values: baseModelNames })
	} catch (error) {
		console.error("Error fetching SAP AI Core models:", error)
		return StringArray.create({ values: [] })
	}
}
