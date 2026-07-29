import { describe, expect, it, vi } from "vitest";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";
import {
	gateVoiceSendIfMuted,
	isHumanMutedInRoomSnapshot,
	rejectVoiceSendIfMuted,
} from "./drive-mute-gate";

describe("isHumanMutedInRoomSnapshot", () => {
	it("detects drive:human mute map entry", () => {
		expect(
			isHumanMutedInRoomSnapshot({
				muteByParticipantId: { "drive:human": true },
				participants: [
					{ id: "drive:human", kind: "human", displayName: "You" } as never,
				],
			}),
		).toBe(true);
	});

	it("detects legacy you / human ids", () => {
		expect(
			isHumanMutedInRoomSnapshot({
				muteByParticipantId: { you: true },
				participants: [],
			}),
		).toBe(true);
		expect(
			isHumanMutedInRoomSnapshot({
				muteByParticipantId: { human: true },
				participants: [],
			}),
		).toBe(true);
	});

	it("detects any human participant marked muted", () => {
		expect(
			isHumanMutedInRoomSnapshot({
				muteByParticipantId: { "user-abc": true },
				participants: [
					{ id: "user-abc", kind: "human", displayName: "Ada" } as never,
				],
			}),
		).toBe(true);
	});

	it("returns false when unmuted or empty", () => {
		expect(
			isHumanMutedInRoomSnapshot({
				muteByParticipantId: { "drive:human": false },
				participants: [
					{ id: "drive:human", kind: "human", displayName: "You" } as never,
				],
			}),
		).toBe(false);
		expect(
			isHumanMutedInRoomSnapshot({
				muteByParticipantId: {},
				participants: [],
			}),
		).toBe(false);
	});
});

describe("gateVoiceSendIfMuted / rejectVoiceSendIfMuted", () => {
	function peer(sessionId?: string): BrowserPeer {
		return { selectedSessionId: sessionId } as BrowserPeer;
	}

	function ctx(command: ReturnType<typeof vi.fn>): {
		context: HubContext;
		sent: unknown[];
	} {
		const sent: unknown[] = [];
		const context = {
			uiClient: { command },
			send: (_peer: BrowserPeer, message: unknown) => {
				sent.push(message);
			},
		} as unknown as HubContext;
		return { context, sent };
	}

	it("allows send when no session is selected", async () => {
		const { context } = ctx(vi.fn());
		const result = await gateVoiceSendIfMuted(context, peer(undefined));
		expect(result).toEqual({ blocked: false });
	});

	it("allows send when room is not linked / command fails", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: false,
			error: { code: "room_not_found" },
		});
		const { context } = ctx(command);
		const result = await gateVoiceSendIfMuted(context, peer("sess-1"));
		expect(result).toEqual({ blocked: false });
		expect(command).toHaveBeenCalledWith("call_get_room", {
			sessionId: "sess-1",
		});
	});

	it("blocks voice send when human is muted", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: true,
			payload: {
				snapshot: {
					muteByParticipantId: { "drive:human": true },
					participants: [
						{ id: "drive:human", kind: "human", displayName: "You" },
					],
				},
			},
		});
		const { context, sent } = ctx(command);
		const blocked = await rejectVoiceSendIfMuted(context, peer("sess-muted"));
		expect(blocked).toBe(true);
		expect(sent).toEqual([
			{
				type: "error",
				code: "mic_muted",
				text: "Mic is muted. Unmute on the call strip before sending spoken input.",
			},
		]);
	});

	it("allows voice send when human is not muted", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: true,
			payload: {
				snapshot: {
					muteByParticipantId: { "drive:human": false },
					participants: [
						{ id: "drive:human", kind: "human", displayName: "You" },
					],
				},
			},
		});
		const { context, sent } = ctx(command);
		const blocked = await rejectVoiceSendIfMuted(context, peer("sess-ok"));
		expect(blocked).toBe(false);
		expect(sent).toEqual([]);
	});
});
