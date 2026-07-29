import type { RoomSnapshot } from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

/** Matches webview `DRIVE_PARTICIPANT_HUMAN` / `applyRoomSnapshot` fallback. */
const DEFAULT_HUMAN_ID = "drive:human";

/**
 * Pure check: is the Drive human muted in this room snapshot?
 * Used before forwarding voice-sourced Chat sends (DRV-MIC).
 *
 * Mirrors webview `applyRoomSnapshot`: mute for the seated human participant
 * id only (not every legacy key), so strip UI and hub gate stay aligned.
 */
export function isHumanMutedInRoomSnapshot(
	snapshot: Pick<RoomSnapshot, "muteByParticipantId" | "participants">,
): boolean {
	const muteMap = snapshot.muteByParticipantId ?? {};
	const human = (snapshot.participants ?? []).find(
		(participant) => participant.kind === "human",
	);
	const humanId = human?.id ?? DEFAULT_HUMAN_ID;
	return muteMap[humanId] === true;
}

export type VoiceMuteGateResult =
	| { blocked: false }
	| { blocked: true; code: "mic_muted"; message: string };

/**
 * When a peer sends a voice-sourced prompt, reject if their linked Drive room
 * has the human muted. Typed text sends skip this gate.
 */
export async function gateVoiceSendIfMuted(
	ctx: HubContext,
	peer: BrowserPeer,
): Promise<VoiceMuteGateResult> {
	const sessionId = peer.selectedSessionId;
	if (!sessionId || !ctx.uiClient) {
		return { blocked: false };
	}

	try {
		const reply = await ctx.uiClient.command("call_get_room", { sessionId });
		if (!reply.ok) {
			// No linked room / room missing — allow send (not a Drive voice room).
			return { blocked: false };
		}
		const snapshot = reply.payload?.snapshot as
			| Pick<RoomSnapshot, "muteByParticipantId" | "participants">
			| undefined;
		if (!snapshot || typeof snapshot !== "object") {
			return { blocked: false };
		}
		if (!isHumanMutedInRoomSnapshot(snapshot)) {
			return { blocked: false };
		}
		return {
			blocked: true,
			code: "mic_muted",
			message:
				"Mic is muted. Unmute on the call strip before sending spoken input.",
		};
	} catch {
		// Room lookup failures should not block typed-equivalent recovery paths.
		return { blocked: false };
	}
}

/** Notify the peer and return true when the voice send was blocked. */
export async function rejectVoiceSendIfMuted(
	ctx: HubContext,
	peer: BrowserPeer,
): Promise<boolean> {
	const result = await gateVoiceSendIfMuted(ctx, peer);
	if (!result.blocked) {
		return false;
	}
	ctx.send(peer, {
		type: "error",
		text: result.message,
		code: result.code,
	});
	return true;
}
