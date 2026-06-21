import * as proto from "@/shared/proto"
import { Controller } from "../index"

export async function updateTerminalReuseEnabled(
	_controller: Controller,
	_request: proto.cline.BooleanRequest,
): Promise<proto.cline.Empty> {
	return proto.cline.Empty.create({})
}
