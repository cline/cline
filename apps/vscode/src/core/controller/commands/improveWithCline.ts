import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { Controller } from "../index"

export async function improveWithCline(
	_controller: Controller,
	_request: CommandContext,
	_notebookContext?: string,
): Promise<Empty> {
	return Empty.create({})
}
