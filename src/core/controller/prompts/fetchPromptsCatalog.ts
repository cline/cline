import type { EmptyRequest } from "@shared/proto/cline/common"
import type { PromptsCatalog } from "@shared/proto/cline/prompts"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * Fetches the prompts catalog from the PromptsService
 */
export async function fetchPromptsCatalog(controller: Controller, _request: EmptyRequest): Promise<PromptsCatalog> {
	try {
		// Fetch catalog from PromptsService
		const catalog = await controller.promptsService.fetchPromptsCatalog()

		return {
			items: catalog.items.map((item) => ({
				promptId: item.promptId,
				githubUrl: item.githubUrl,
				name: item.name,
				author: item.author,
				description: item.description,
				category: item.category,
				tags: item.tags,
				type: item.type === "rule" ? 1 : 2, // Convert string to proto enum
				content: item.content,
				version: item.version || "",
				globs: item.globs || [],
				createdAt: item.createdAt,
				updatedAt: item.updatedAt,
			})),
			lastUpdated: catalog.lastUpdated,
		}
	} catch (error) {
		Logger.error("Error in fetchPromptsCatalog:", error)
		// Return empty catalog on error
		return {
			items: [],
			lastUpdated: new Date().toISOString(),
		}
	}
}
