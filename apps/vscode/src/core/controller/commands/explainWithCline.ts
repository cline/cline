import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { Controller } from "../index"

export async function explainWithCline(
	_controller: Controller,
	_request: CommandContext,
	_notebookContext?: string,
): Promise<Empty> {
	return Empty.create({})
}
