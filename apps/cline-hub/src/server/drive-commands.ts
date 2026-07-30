import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

type DriveWebviewCommand =
	| "drive.room.get"
	| "drive.spotlight.set"
	| "drive.participant.mute.set"
	| "drive.participant.deafen.set"
	| "drive.show.present"
	| "drive.show.enqueue"
	| "drive.show.tick"
	| "drive.do.enqueue"
	| "drive.planner.set"
	| "drive.script.attach"
	| "drive.script.advance"
	| "drive.fork.list"
	| "drive.fork.audit.get"
	| "drive.fork.retain.set";

export async function handleDriveWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: {
		type: "driveCommand";
		command: DriveWebviewCommand;
		payload?: Record<string, unknown>;
	},
): Promise<void> {
	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "error",
			text: "Hub UI client is not connected.",
		});
		return;
	}
	const reply = await ctx.uiClient.command(frame.command, frame.payload ?? {});
	if (!reply.ok) {
		ctx.send(peer, {
			type: "error",
			text: reply.error?.message ?? `Drive command ${frame.command} failed.`,
		});
		return;
	}

	if (frame.command === "drive.fork.audit.get") {
		const auditHandle =
			typeof frame.payload?.auditHandle === "string"
				? frame.payload.auditHandle
				: "";
		ctx.send(peer, {
			type: "drive_fork_audit",
			auditHandle,
			messages: Array.isArray(reply.payload?.messages)
				? reply.payload.messages
				: [],
			summaryOnly: reply.payload?.summaryOnly === true,
			fork:
				reply.payload?.fork && typeof reply.payload.fork === "object"
					? reply.payload.fork
					: undefined,
		});
		return;
	}

	if (reply.payload?.room && typeof reply.payload.room === "object") {
		ctx.send(peer, {
			type: "drive_room_changed",
			room: reply.payload.room,
		});
		return;
	}

	if (
		frame.command === "drive.fork.list" &&
		Array.isArray(reply.payload?.chatForks)
	) {
		ctx.send(peer, {
			type: "drive_room_changed",
			room: {
				roomId:
					typeof reply.payload.roomId === "string"
						? reply.payload.roomId
						: "default",
				spotlightParticipantId: null,
				participantAudio: [],
				director: {
					activeShowId: null,
					stickyShowIds: [],
					spotlightParticipantId: null,
					showBacklog: [],
				},
				chatForks: reply.payload.chatForks,
				version: 0,
			},
		});
	}
}
