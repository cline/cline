import { EmptyRequest } from "@shared/proto/bedrock_coder/common"
import { TeamBoard } from "@shared/proto/bedrock_coder/team"
import { Controller } from ".."
import { toTeamBoardProto } from "./team-conversions"

export async function getTeamBoard(controller: Controller, _request: EmptyRequest): Promise<TeamBoard> {
	return toTeamBoardProto(controller.getActiveTeamBoard())
}
