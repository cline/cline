import type { HubCommandName, RoomSnapshot } from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

function asRoomSnapshot(value: unknown): RoomSnapshot | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.roomId !== "string") {
		return undefined;
	}
	return value as RoomSnapshot;
}

export async function handleCallCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: {
		type:
			| "call_join"
			| "call_leave"
			| "call_mute"
			| "call_set_stage"
			| "call_set_mode"
			| "call_get_room";
		[key: string]: unknown;
	},
): Promise<void> {
	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "call_error",
			text: "Hub is not connected.",
			code: "hub_disconnected",
		});
		return;
	}

	const command = frame.type as HubCommandName;
	const { type: _type, ...payload } = frame;
	try {
		const reply = await ctx.uiClient.command(
			command,
			payload as Record<string, unknown>,
		);
		if (!reply.ok) {
			ctx.send(peer, {
				type: "call_error",
				text: reply.error?.message ?? "Call command failed.",
				code: reply.error?.code,
			});
			return;
		}
		const snapshot = asRoomSnapshot(reply.payload?.snapshot);
		const roomId =
			(typeof reply.payload?.roomId === "string"
				? reply.payload.roomId
				: undefined) ?? snapshot?.roomId;
		if (snapshot && roomId) {
			ctx.send(peer, {
				type: "room_snapshot",
				roomId,
				snapshot,
			});
		}
	} catch (error) {
		ctx.send(peer, {
			type: "call_error",
			text: error instanceof Error ? error.message : String(error),
			code: "call_command_failed",
		});
	}
}
