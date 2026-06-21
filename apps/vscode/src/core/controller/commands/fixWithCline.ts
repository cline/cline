import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { Controller } from "../index"

export async function fixWithCline(_controller: Controller, _request: CommandContext): Promise<Empty> {
	return Empty.create({})
}
