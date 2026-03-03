import type { EmptyRequest } from "@shared/proto/cline/common"
import type { TeamPromptsCatalog } from "@shared/proto/cline/prompts"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * Fetches team prompts for the user's organization
 */
export async function getTeamPrompts(_controller: Controller, _request: EmptyRequest): Promise<TeamPromptsCatalog> {
	try {
		// TODO: Implement fetching team prompts from enterprise API
		// For now, return empty catalog
		return {
			items: [],
			organizationId: "",
		}
	} catch (error) {
		Logger.error("Error in getTeamPrompts:", error)
		return {
			items: [],
			organizationId: "",
		}
	}
}
