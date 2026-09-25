import { SearchTaskHistoryRequest, SearchTaskHistoryResponse, TaskSearchHit } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Advanced search: full-text search across task message content (tool output,
 * responses, code snippets, file names), not just the title/prompt getTaskHistory
 * matches. Existing search is unaffected — this is an additional, separate query.
 * @param controller The controller instance
 * @param request The search query and result limit
 * @returns SearchTaskHistoryResponse with ranked hits
 */
export async function searchTaskHistory(
	controller: Controller,
	request: SearchTaskHistoryRequest,
): Promise<SearchTaskHistoryResponse> {
	try {
		const hits = await controller.searchTaskHistory(request.query, request.limit)
		return SearchTaskHistoryResponse.create({
			hits: hits.map((hit) =>
				TaskSearchHit.create({
					id: hit.sessionId,
					title: hit.title,
					snippet: hit.snippet,
					role: hit.role,
					ts: Date.parse(hit.startedAt) || 0,
					score: hit.score,
				}),
			),
		})
	} catch (error) {
		Logger.error("Error in searchTaskHistory:", error)
		throw error
	}
}
