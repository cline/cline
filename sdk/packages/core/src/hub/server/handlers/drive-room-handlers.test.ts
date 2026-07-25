import { describe, expect, it } from "vitest";
import { resetDriveRoomStoreForTests } from "../../collaboration";
import { buildHubEvent, type HubTransportContext, okReply } from "./context";
import { handleDriveRoomCommand } from "./drive-room-handlers";

function makeCtx(): HubTransportContext & { published: unknown[] } {
	const published: unknown[] = [];
	return {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionHost: {} as HubTransportContext["sessionHost"],
		publish(event) {
			published.push(event);
		},
		buildEvent: buildHubEvent,
		requestCapability: async () => undefined,
		published,
	};
}

describe("handleDriveRoomCommand", () => {
	it("joins via joinCall and publishes room.snapshot", () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		const reply = handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "r1",
			payload: {
				roomId: "room_h1",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		expect(reply.ok).toBe(true);
		expect(reply.payload?.roomId).toBe("room_h1");
		expect(ctx.published.some((e) => (e as { event: string }).event === "room.snapshot")).toBe(
			true,
		);

		const leave = handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_leave",
			requestId: "r2",
			payload: { roomId: "room_h1", participantId: "you" },
		});
		expect(leave.ok).toBe(true);

		const stage = handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_set_stage",
			requestId: "r3",
			payload: {
				roomId: "room_h1",
				sharer: { kind: "agent", participantId: "adam" },
			},
		});
		expect(stage.ok).toBe(true);
		expect(okReply({ version: "v1", requestId: "x" }).ok).toBe(true);
	});

	it("returns room_not_found for leave on missing room", () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		const reply = handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_leave",
			requestId: "r4",
			payload: { roomId: "missing", participantId: "you" },
		});
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("room_not_found");
	});
});
