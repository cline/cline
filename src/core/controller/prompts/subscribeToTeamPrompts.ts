import type { EmptyRequest } from "@shared/proto/cline/common"
import type { TeamPromptsCatalog } from "@shared/proto/cline/prompts"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."
import type { StreamingResponseHandler } from "../grpc-handler"

/**
 * Subscribes to team prompts updates
 */
export async function subscribeToTeamPrompts(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<TeamPromptsCatalog>,
	_requestId?: string,
): Promise<void> {
	try {
		// TODO: Implement fetching team prompts from enterprise API
		// For now, return empty catalog
		await responseStream(
			{
				items: [],
				organizationId: "",
			},
			false, // Not the last message
		)
	} catch (error) {
		Logger.error("Error in subscribeToTeamPrompts:", error)
		await responseStream(
			{
				items: [],
				organizationId: "",
			},
			true, // Last message
		)
	}
}
