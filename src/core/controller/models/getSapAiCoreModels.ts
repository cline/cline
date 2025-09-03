import axios from "axios"
import { SapAiCoreModelsRequest, SapAiCoreModelsResponse } from "@/shared/proto/cline/models"
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
 * Fetches model names and orchestration availability from SAP AI Core deployments
 * @param accessToken Access token for authentication
 * @param baseUrl SAP AI Core base URL
 * @param resourceGroup SAP AI Core resource group
 * @returns Promise<{modelNames: string[], orchestrationAvailable: boolean}> Model names and orchestration availability
 */
async function fetchAiCoreModelsAndOrchestration(
	accessToken: string,
	baseUrl: string,
	resourceGroup: string,
): Promise<{ modelNames: string[]; orchestrationAvailable: boolean }> {
	if (!accessToken) {
		return { modelNames: ["ai-core-not-configured"], orchestrationAvailable: false }
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

		// Filter running deployments
		const runningDeployments = deployments.filter((deployment: any) => deployment.targetStatus === "RUNNING")

		// Check for orchestration deployment
		const orchestrationAvailable = runningDeployments.some((deployment: any) => deployment.scenarioId === "orchestration")

		// Extract model names from deployments
		const modelNames = runningDeployments
			.map((deployment: any) => {
				const model = deployment.details?.resources?.backend_details?.model
				if (!model?.name || !model?.version) {
					return null // Skip this row
				}
				return `${model.name}:${model.version}`
			})
			.filter((modelName: string | null) => modelName !== null)

		return { modelNames, orchestrationAvailable }
	} catch (error) {
		console.error("Error fetching deployments:", error)
		throw new Error("Failed to fetch deployments")
	}
}

/**
 * Fetches available models from SAP AI Core deployments and orchestration availability
 * @param controller The controller instance
 * @param request The request containing SAP AI Core configuration
 * @returns SapAiCoreModelsResponse with model names and orchestration availability
 */
export async function getSapAiCoreModels(
	_controller: Controller,
	request: SapAiCoreModelsRequest,
): Promise<SapAiCoreModelsResponse> {
	try {
		// Check if required configuration is provided
		if (!request.clientId || !request.clientSecret || !request.baseUrl) {
			// Return empty response if configuration is incomplete
			return SapAiCoreModelsResponse.create({
				modelNames: [],
				orchestrationAvailable: false,
			})
		}

		// Direct authentication and model/orchestration fetching
		const token = await getToken(request.clientId, request.clientSecret, request.tokenUrl)
		const { modelNames, orchestrationAvailable } = await fetchAiCoreModelsAndOrchestration(
			token.access_token,
			request.baseUrl,
			request.resourceGroup,
		)

		// Extract base model names (without version) and sort
		const baseModelNames = modelNames.map((modelName: string) => modelName.split(":")[0].toLowerCase()).sort()

		return SapAiCoreModelsResponse.create({
			modelNames: baseModelNames,
			orchestrationAvailable,
		})
	} catch (error) {
		console.error("Error fetching SAP AI Core models:", error)
		return SapAiCoreModelsResponse.create({
			modelNames: [],
			orchestrationAvailable: false,
		})
	}
}
