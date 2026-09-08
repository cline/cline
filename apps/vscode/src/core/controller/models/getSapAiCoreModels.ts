import { DeploymentApi } from "@sap-ai-sdk/ai-api"
import { fetch } from "@/shared/net"
import { SapAiCoreModelDeployment, type SapAiCoreModelsRequest, SapAiCoreModelsResponse } from "@/shared/proto/cline/models"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * Fetches available models from SAP AI Core deployments and orchestration availability
 * @param controller The controller instance
 * @param request The request containing SAP AI Core configuration
 * @returns SapAiCoreModelsResponse with deployments and orchestration availability
 */
export async function getSapAiCoreModels(
	controller: Controller,
	request: SapAiCoreModelsRequest,
): Promise<SapAiCoreModelsResponse> {
	try {
		// Check if required configuration is provided
		if (!request.clientId || !request.clientSecret || !request.baseUrl) {
			// Return empty response if configuration is incomplete
			return SapAiCoreModelsResponse.create({
				deployments: [],
				orchestrationAvailable: false,
			})
		}

		const clean = (val: string | undefined): string => {
			if (!val) return ""
			let cleaned = val.trim()
			if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
				cleaned = cleaned.slice(1, -1).trim()
			}
			if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
				cleaned = cleaned.slice(1, -1).trim()
			}
			return cleaned
		}

		const clientId = clean(request.clientId)
		const clientSecret = clean(request.clientSecret)
		const tokenUrl = clean(request.tokenUrl)
		let baseUrl = clean(request.baseUrl)
		if (baseUrl) {
			baseUrl = baseUrl.replace(/\/+$/, "")
			if (baseUrl.endsWith("/v2")) {
				baseUrl = baseUrl.slice(0, -3).replace(/\/+$/, "")
			}
		}

		// 1. Fetch access token manually to bypass destination service
		const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
		const oauthUrl = tokenUrl.endsWith("/oauth/token") ? tokenUrl : `${tokenUrl.replace(/\/+$/, "")}/oauth/token`

		const tokenResponse = await fetch(oauthUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: authHeader,
			},
			body: "grant_type=client_credentials",
		})

		if (!tokenResponse.ok) {
			const errorText = await tokenResponse.text().catch(() => "")
			throw new Error(
				`Failed to fetch access token from SAP AI Core auth URL: status ${tokenResponse.status} ${tokenResponse.statusText}. Details: ${errorText}`,
			)
		}

		const tokenData = (await tokenResponse.json()) as { access_token: string }
		const accessToken = tokenData.access_token

		if (!accessToken) {
			throw new Error("Access token is missing from token response")
		}

		// 2. Build the manual destination with pre-populated authTokens
		const destination = {
			url: baseUrl,
			authentication: "OAuth2ClientCredentials" as const,
			authTokens: [
				{
					type: "Bearer",
					value: accessToken,
					error: null,
					expiresIn: "3600",
					http_header: {
						key: "Authorization",
						value: `Bearer ${accessToken}`,
					},
				},
			],
		}

		const response = await DeploymentApi.deploymentQuery(
			{},
			{
				"AI-Resource-Group": request.resourceGroup || "default",
			},
		).execute(destination)

		const allDeployments = response.resources || []

		const runningDeployments = allDeployments.filter((deployment: any) => deployment.targetStatus === "RUNNING")

		const orchestrationAvailable = runningDeployments.some((deployment: any) => deployment.scenarioId === "orchestration")

		const deployments = runningDeployments
			.map((deployment: any) => {
				if (deployment.scenarioId === "orchestration") {
					return {
						id: deployment.id,
						name: "orchestration",
					}
				}
				const model = deployment.details?.resources?.backend_details?.model
				if (!model?.name || !model?.version) {
					return null // Skip this row
				}
				return {
					id: deployment.id,
					name: `${model.name}:${model.version}`,
				}
			})
			.filter((deployment: any) => deployment !== null)

		// Create model-deployment pairs
		const modelDeployments = deployments
			.map((deployment: any) => {
				const modelName = deployment.name.split(":")[0].toLowerCase()
				return SapAiCoreModelDeployment.create({
					modelName: modelName,
					deploymentId: deployment.id,
				})
			})
			.sort((a: any, b: any) => a.modelName.localeCompare(b.modelName))

		return SapAiCoreModelsResponse.create({
			deployments: modelDeployments,
			orchestrationAvailable,
		})
	} catch (error: any) {
		Logger.error("Error fetching SAP AI Core models:", {
			message: error?.message,
			stack: error?.stack,
			cause: error?.cause
				? {
						message: error.cause?.message,
						stack: error.cause?.stack,
						cause: error.cause?.cause
							? {
									message: error.cause.cause?.message,
									stack: error.cause.cause?.stack,
								}
							: undefined,
					}
				: undefined,
		})
		return SapAiCoreModelsResponse.create({
			deployments: [],
			orchestrationAvailable: false,
		})
	}
}
