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

	it("call_record_work from tool-shaped input fills stage.cards and broadcasts", () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j1",
			payload: {
				roomId: "room_work",
				sessionId: "sess_work",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		ctx.published.length = 0;

		const reply = handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_record_work",
			requestId: "w1",
			payload: {
				sessionId: "sess_work",
				tool: {
					toolCallId: "tc_edit",
					toolName: "write_to_file",
					status: "completed",
					input: { path: "apps/hub/Chat.tsx", new_text: "export {}" },
					output: "ok",
				},
			},
		});
		expect(reply.ok).toBe(true);
		const snapshot = reply.payload?.snapshot as {
			stage: { cards: Array<{ category: string; title: string }> };
		};
		expect(snapshot.stage.cards.some((c) => c.category === "edit")).toBe(true);
		expect(
			ctx.published.some((e) => (e as { event: string }).event === "room.event"),
		).toBe(true);

		const cmd = handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_record_work",
			requestId: "w2",
			payload: {
				roomId: "room_work",
				work: {
					kind: "command",
					command: "bun -F @cline/core test:unit",
					failed: false,
				},
			},
		});
		expect(cmd.ok).toBe(true);
		const cards = (
			cmd.payload?.snapshot as {
				stage: { cards: Array<{ category: string }> };
			}
		).stage.cards;
		expect(cards.map((c) => c.category).sort()).toEqual(["command", "edit"]);
	});

	it("call_get_room returns current snapshot; missing room errors", () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j2",
			payload: {
				roomId: "room_get",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		const got = handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_get_room",
			requestId: "g1",
			payload: { roomId: "room_get" },
		});
		expect(got.ok).toBe(true);
		expect(got.payload?.roomId).toBe("room_get");

		const missing = handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_get_room",
			requestId: "g2",
			payload: { roomId: "gone" },
		});
		expect(missing.ok).toBe(false);
		expect(missing.error?.code).toBe("room_not_found");
	});

	it("handoff: join → record work → human pin → agent clears pin", () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "h0",
			payload: {
				roomId: "room_handoff",
				sessionId: "sess_handoff",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_record_work",
			requestId: "h1",
			payload: {
				roomId: "room_handoff",
				work: { kind: "edit", path: "a.ts", summary: "diff" },
			},
		});
		handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_record_work",
			requestId: "h2",
			payload: {
				roomId: "room_handoff",
				work: { kind: "command", command: "ls", failed: false },
			},
		});
		const human = handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_set_stage",
			requestId: "h3",
			payload: {
				roomId: "room_handoff",
				sharer: { kind: "human", participantId: "you" },
				pin: {
					kind: "selection",
					label: "Selected block",
					ref: "const x = 1",
				},
			},
		});
		expect(human.ok).toBe(true);
		const humanSnap = human.payload?.snapshot as {
			stage: {
				sharer: { kind: string } | null;
				pin: { kind: string; ref?: string } | null;
				cards: unknown[];
			};
		};
		expect(humanSnap.stage.sharer?.kind).toBe("human");
		expect(humanSnap.stage.pin?.ref).toBe("const x = 1");
		expect(humanSnap.stage.cards.length).toBeGreaterThanOrEqual(2);

		const agent = handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_set_stage",
			requestId: "h4",
			payload: {
				roomId: "room_handoff",
				sharer: { kind: "agent", participantId: "adam" },
				pin: null,
			},
		});
		const agentSnap = agent.payload?.snapshot as {
			stage: {
				sharer: { kind: string } | null;
				pin: unknown;
				cards: unknown[];
			};
		};
		expect(agentSnap.stage.sharer?.kind).toBe("agent");
		expect(agentSnap.stage.pin).toBeNull();
		expect(agentSnap.stage.cards.length).toBeGreaterThanOrEqual(2);
	});
});
