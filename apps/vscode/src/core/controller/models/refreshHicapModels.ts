import { GlobalFileNames } from "@core/storage/disk"
import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * The raw model information returned by the Hicap API to list models
 */
interface HicapRawModelInfo {
	id: string
	object: string
}

/**
 * Refreshes the Hicap models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the OpenRouter models
 */
// TODO(sdk-consolidation): Live-fetches Hicap's /models endpoint, which the CLI
// lacks and the SDK does not yet cover. Register `modelsSourceUrl` for Hicap in
// the SDK (sdk/packages/llms/src/providers/builtins.ts) so all clients share one
// fetch path via `resolveProviderConfig`/`useProviderModels`, then delete this
// extension-only handler + its RPC.
export async function refreshHicapModels(controller: Controller, _request: EmptyRequest): Promise<OpenRouterCompatibleModelInfo> {
	const hicapModelsFilePath = path.join(await ensureCacheDirectoryExists(controller), GlobalFileNames.hicapModels)

	const models: Record<string, OpenRouterModelInfo> = {}
	try {
		// Get the Hicap API key from the controller's state
		const hicapApiKey = controller.stateManager.getSecretKey("hicapApiKey")

		const response = await axios.get("https://api.hicap.ai/v2/openai/models", {
			headers: {
				"api-key": hicapApiKey,
			},
			...getAxiosSettings(),
		})

		if (response.data?.data) {
			const rawModels = response.data.data

			for (const rawModel of rawModels as HicapRawModelInfo[]) {
				models[rawModel.id] = {
					maxTokens: -1,
					contextWindow: 128_000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 0,
					outputPrice: 0,
					cacheWritesPrice: 0,
					cacheReadsPrice: 0,
					tiers: [],
					description: "",
				}
			}
		}
		await fs.writeFile(hicapModelsFilePath, JSON.stringify(models))
	} catch (_error) {
		// If we failed to fetch models, keep whatever we have.
	}

	return OpenRouterCompatibleModelInfo.create({ models })
}

/**
 * Ensures the cache directory exists and returns its path
 */
async function ensureCacheDirectoryExists(controller: Controller): Promise<string> {
	const cacheDir = path.join(controller.context.globalStorageUri.fsPath, "cache")
	await fs.mkdir(cacheDir, { recursive: true })
	return cacheDir
}
