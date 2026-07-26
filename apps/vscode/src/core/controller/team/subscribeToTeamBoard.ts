import { EmptyRequest } from "@shared/proto/cline/common"
import { TeamBoard } from "@shared/proto/cline/team"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { toTeamBoardProto } from "./team-conversions"

const subscriptions = new Set<StreamingResponseHandler<TeamBoard>>()

export async function subscribeToTeamBoard(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<TeamBoard>,
	requestId?: string,
): Promise<void> {
	subscriptions.add(responseStream)
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			() => subscriptions.delete(responseStream),
			{ type: "team_board_subscription" },
			responseStream,
		)
	}
	await responseStream(toTeamBoardProto(controller.getActiveTeamBoard()), false)
}

export function sendTeamBoardUpdate(controller: Controller): void {
	const board = toTeamBoardProto(controller.getActiveTeamBoard())
	for (const responseStream of subscriptions) {
		responseStream(board, false).catch((error) => {
			Logger.error("Error sending local team board update:", error)
			subscriptions.delete(responseStream)
		})
	}
}
