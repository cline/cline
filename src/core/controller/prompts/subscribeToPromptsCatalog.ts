import type { EmptyRequest } from "@shared/proto/cline/common"
import type { PromptsCatalog } from "@shared/proto/cline/prompts"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."
import type { StreamingResponseHandler } from "../grpc-handler"

/**
 * Subscribes to prompts catalog updates
 */
export async function subscribeToPromptsCatalog(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<PromptsCatalog>,
	_requestId?: string,
): Promise<void> {
	try {
		// Fetch initial catalog
		const catalog = await controller.promptsService.fetchPromptsCatalog()

		// Send initial catalog
		await responseStream(
			{
				items: catalog.items.map((item) => ({
					promptId: item.promptId,
					githubUrl: item.githubUrl,
					name: item.name,
					author: item.author,
					description: item.description,
					category: item.category,
					tags: item.tags,
					type: item.type === "rule" ? 1 : 2,
					content: item.content,
					version: item.version || "",
					globs: item.globs || [],
					createdAt: item.createdAt,
					updatedAt: item.updatedAt,
				})),
				lastUpdated: catalog.lastUpdated,
			},
			false, // Not the last message
		)

		// TODO: Set up file watcher for prompts directory and stream updates
	} catch (error) {
		Logger.error("Error fetching prompts catalog:", error)
		// Return empty catalog on error
		await responseStream(
			{
				items: [],
				lastUpdated: new Date().toISOString(),
			},
			true, // Last message
		)
	}
}
