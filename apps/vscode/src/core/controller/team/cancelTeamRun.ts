import { CancelTeamRunRequest, TeamRun } from "@shared/proto/cline/team"
import { Controller } from ".."
import { toTeamRunProto } from "./team-conversions"

export async function cancelTeamRun(controller: Controller, request: CancelTeamRunRequest): Promise<TeamRun> {
	return toTeamRunProto(controller.cancelActiveTeamRun(request.runId, request.reason))
}
