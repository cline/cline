import path from "node:path"
import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { Empty, type StringRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from ".."
/**
 * Opens a file in the editor
 * @param controller The controller instance
 * @param request The request message containing the file path in the 'value' field
 * @returns Empty response
 */
export async function openTaskHistory(_controller: Controller, request: StringRequest): Promise<Empty> {
	const globalStoragePath = HostProvider.get().globalStorageFsPath
	const taskHistoryPath = path.join(globalStoragePath, "tasks", request.value, "api_conversation_history.json")
	if (request.value) {
		openFileIntegration(taskHistoryPath)
	}
	return Empty.create()
}
