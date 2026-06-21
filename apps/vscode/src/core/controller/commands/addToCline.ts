import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { Controller } from "../index"

// 'Add to Cline' context menu in editor and code action
// Inserts the selected code into the chat.
export async function addToCline(_controller: Controller, _request: CommandContext, _notebookContext?: string): Promise<Empty> {
	return Empty.create({})
}
