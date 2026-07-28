import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

export async function handleDriveWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: {
		type: "driveCommand";
		command:
			| "drive.room.get"
			| "drive.spotlight.set"
			| "drive.participant.mute.set"
			| "drive.participant.deafen.set"
			| "drive.show.present";
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
	if (reply.payload?.room && typeof reply.payload.room === "object") {
		ctx.send(peer, {
			type: "drive_room_changed",
			room: reply.payload.room,
		});
	}
}
