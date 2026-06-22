import * as proto from "@/shared/proto"
import { Controller } from "../index"

export async function getAvailableTerminalProfiles(
	_controller: Controller,
	_request: proto.cline.EmptyRequest,
): Promise<proto.cline.TerminalProfiles> {
	return proto.cline.TerminalProfiles.create({})
}
