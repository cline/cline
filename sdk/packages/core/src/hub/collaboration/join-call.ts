/**
 * joinCall façade: create-or-attach a room and seat one human host + one
 * pair_partner agent (DRV-ROOM-MVP).
 */

import type { AgentParticipant, HumanParticipant, RoomSnapshot } from "@cline/shared";
import { type DriveRoomStore, getDriveRoomStore } from "./room";

export type JoinCallInput = {
	roomId: string;
	human: Pick<HumanParticipant, "id" | "displayName"> & {
		role?: HumanParticipant["role"];
	};
	agent: Pick<AgentParticipant, "id" | "displayName"> & {
		role?: AgentParticipant["role"];
	};
	/** When true (default), set driveActive and stage sharer to the agent. */
	activateDrive?: boolean;
	/** Optional agent session linked for tool → room work bridge. */
	sessionId?: string;
};

export type JoinCallResult = {
	snapshot: RoomSnapshot;
	created: boolean;
};

export function joinCall(
	input: JoinCallInput,
	store: DriveRoomStore = getDriveRoomStore(),
): JoinCallResult {
	const existed = store.get(input.roomId) != null;
	store.create(input.roomId);

	const human: HumanParticipant = {
		id: input.human.id,
		kind: "human",
		displayName: input.human.displayName,
		role: input.human.role ?? "host",
		status: "idle",
	};
	const agent: AgentParticipant = {
		id: input.agent.id,
		kind: "agent",
		displayName: input.agent.displayName,
		role: input.agent.role ?? "partner",
		status: "idle",
		seatSources: [],
	};

	store.join({
		roomId: input.roomId,
		participant: human,
		sessionId: input.sessionId,
	});
	store.join({ roomId: input.roomId, participant: agent });
	if (input.sessionId) {
		store.linkSession(input.sessionId, input.roomId);
	}

	const activate = input.activateDrive !== false;
	if (activate) {
		store.setMode({
			roomId: input.roomId,
			subMode: "act",
			driveActive: true,
			actorId: human.id,
		});
		store.setStage({
			roomId: input.roomId,
			sharer: { kind: "agent", participantId: agent.id },
			actorId: agent.id,
		});
	}

	return {
		snapshot: store.getOrThrow(input.roomId),
		created: !existed,
	};
}
