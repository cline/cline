import { EmptyRequest } from "@shared/proto/cline/common"
import { SlashCommandsResponse } from "@shared/proto/cline/slash"
import { Controller } from ".."

/**
 * Returns all available slash commands for autocomplete.
 */
export async function getAvailableSlashCommands(_controller: Controller, _request: EmptyRequest): Promise<SlashCommandsResponse> {
	return SlashCommandsResponse.create({})
}
