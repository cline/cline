import { describe, expect, it } from "vitest";
import {
	getDriveRoomStore,
	resetDriveRoomStoreForTests,
	shouldDrivePauseAfterTool,
} from "../../collaboration";
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
	it("joins via joinCall and publishes room.snapshot", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		const reply = await handleDriveRoomCommand(ctx, {
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

		const leave = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_leave",
			requestId: "r2",
			payload: { roomId: "room_h1", participantId: "you" },
		});
		expect(leave.ok).toBe(true);

		const stage = await handleDriveRoomCommand(ctx, {
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

	it("returns room_not_found for leave on missing room", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		const reply = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_leave",
			requestId: "r4",
			payload: { roomId: "missing", participantId: "you" },
		});
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("room_not_found");
	});

	it("call_mute and call_raise_hand update snapshot maps and broadcast", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j_mute",
			payload: {
				roomId: "room_mute",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		ctx.published.length = 0;

		const muted = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_mute",
			requestId: "m1",
			payload: {
				roomId: "room_mute",
				participantId: "you",
				muted: true,
			},
		});
		expect(muted.ok).toBe(true);
		const muteSnap = muted.payload?.snapshot as {
			muteByParticipantId: Record<string, boolean>;
		};
		expect(muteSnap.muteByParticipantId.you).toBe(true);

		const partnerMuted = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_mute",
			requestId: "m2",
			payload: {
				roomId: "room_mute",
				participantId: "adam",
				muted: true,
			},
		});
		expect(partnerMuted.ok).toBe(true);
		const partnerSnap = partnerMuted.payload?.snapshot as {
			muteByParticipantId: Record<string, boolean>;
		};
		expect(partnerSnap.muteByParticipantId.adam).toBe(true);

		const hand = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h1",
			payload: {
				roomId: "room_mute",
				participantId: "you",
				raised: true,
			},
		});
		expect(hand.ok).toBe(true);
		const handSnap = hand.payload?.snapshot as {
			raisedHandByParticipantId: Record<string, boolean>;
		};
		expect(handSnap.raisedHandByParticipantId.you).toBe(true);
		expect(
			ctx.published.some((e) => (e as { event: string }).event === "room.event"),
		).toBe(true);

		const lowered = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h2",
			payload: {
				roomId: "room_mute",
				participantId: "you",
				raised: false,
			},
		});
		expect(lowered.ok).toBe(true);
		const loweredSnap = lowered.payload?.snapshot as {
			raisedHandByParticipantId: Record<string, boolean>;
		};
		expect(loweredSnap.raisedHandByParticipantId.you).toBe(false);
	});

	it("call_rename_participant updates displayName and broadcasts", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j_rename",
			payload: {
				roomId: "room_rename",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		ctx.published.length = 0;

		const renamed = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_rename_participant",
			requestId: "rn1",
			payload: {
				roomId: "room_rename",
				participantId: "adam",
				displayName: "Nova",
			},
		});
		expect(renamed.ok).toBe(true);
		const snap = renamed.payload?.snapshot as {
			participants: Array<{ id: string; displayName: string }>;
		};
		expect(
			snap.participants.find((p) => p.id === "adam")?.displayName,
		).toBe("Nova");
		expect(
			ctx.published.some((e) => (e as { event: string }).event === "room.event"),
		).toBe(true);

		const missing = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_rename_participant",
			requestId: "rn2",
			payload: {
				roomId: "room_rename",
				participantId: "ghost",
				displayName: "Nope",
			},
		});
		expect(missing.ok).toBe(false);
	});

	it("call_raise_hand with linked session sets and clears pause-after-tool", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j_pause",
			payload: {
				roomId: "room_pause",
				sessionId: "sess_pause",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		expect(shouldDrivePauseAfterTool("sess_pause")).toBe(false);

		const raised = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h_raise",
			payload: {
				roomId: "room_pause",
				participantId: "you",
				raised: true,
			},
		});
		expect(raised.ok).toBe(true);
		expect(shouldDrivePauseAfterTool("sess_pause")).toBe(true);

		const lowered = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h_lower",
			payload: {
				roomId: "room_pause",
				participantId: "you",
				raised: false,
			},
		});
		expect(lowered.ok).toBe(true);
		expect(shouldDrivePauseAfterTool("sess_pause")).toBe(false);
	});

	it("pause-after-tool stays true while any participant still has hand raised", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j_multi_hand",
			payload: {
				roomId: "room_multi_hand",
				sessionId: "sess_multi_hand",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});

		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h_you",
			payload: {
				roomId: "room_multi_hand",
				participantId: "you",
				raised: true,
			},
		});
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h_adam",
			payload: {
				roomId: "room_multi_hand",
				participantId: "adam",
				raised: true,
			},
		});
		expect(shouldDrivePauseAfterTool("sess_multi_hand")).toBe(true);

		const lowerOne = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h_lower_you",
			payload: {
				roomId: "room_multi_hand",
				participantId: "you",
				raised: false,
			},
		});
		expect(lowerOne.ok).toBe(true);
		expect(shouldDrivePauseAfterTool("sess_multi_hand")).toBe(true);

		const lowerBoth = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h_lower_adam",
			payload: {
				roomId: "room_multi_hand",
				participantId: "adam",
				raised: false,
			},
		});
		expect(lowerBoth.ok).toBe(true);
		expect(shouldDrivePauseAfterTool("sess_multi_hand")).toBe(false);
	});

	it("call_leave clears pause-after-tool when no raised hands remain", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j_leave_pause",
			payload: {
				roomId: "room_leave_pause",
				sessionId: "sess_leave_pause",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h_leave",
			payload: {
				roomId: "room_leave_pause",
				participantId: "you",
				raised: true,
			},
		});
		expect(shouldDrivePauseAfterTool("sess_leave_pause")).toBe(true);

		const leave = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_leave",
			requestId: "l_pause",
			payload: { roomId: "room_leave_pause", participantId: "you" },
		});
		expect(leave.ok).toBe(true);
		expect(shouldDrivePauseAfterTool("sess_leave_pause")).toBe(false);
	});

	it("call_leave keeps pause-after-tool when another participant still has hand raised", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j_leave_other",
			payload: {
				roomId: "room_leave_other",
				sessionId: "sess_leave_other",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h_you_leave",
			payload: {
				roomId: "room_leave_other",
				participantId: "you",
				raised: true,
			},
		});
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_raise_hand",
			requestId: "h_adam_stay",
			payload: {
				roomId: "room_leave_other",
				participantId: "adam",
				raised: true,
			},
		});
		expect(shouldDrivePauseAfterTool("sess_leave_other")).toBe(true);

		const leave = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_leave",
			requestId: "l_other",
			payload: { roomId: "room_leave_other", participantId: "you" },
		});
		expect(leave.ok).toBe(true);
		expect(shouldDrivePauseAfterTool("sess_leave_other")).toBe(true);
	});

	it("call_record_work from tool-shaped input fills stage.cards and broadcasts", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
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

		const reply = await handleDriveRoomCommand(ctx, {
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

		const cmd = await handleDriveRoomCommand(ctx, {
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
		const afterCommand = cmd.payload?.snapshot as
			| { stage: { cards: Array<{ category: string }> } }
			| undefined;
		const cards = afterCommand?.stage.cards ?? [];
		expect(cards.map((c) => c.category).sort()).toEqual(["command", "edit"]);
	});

	it("call_record_work heuristic planner enqueues show on edit, skips command", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j-plan",
			payload: {
				roomId: "room_plan",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		ctx.published.length = 0;

		const edit = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_record_work",
			requestId: "w-edit",
			payload: {
				roomId: "room_plan",
				work: {
					kind: "edit",
					path: "src/foo.ts",
					summary: "touch foo",
				},
			},
		});
		expect(edit.ok).toBe(true);
		expect(
			ctx.published.some(
				(e) => (e as { event: string }).event === "drive.show.planned",
			),
		).toBe(true);
		const planned = ctx.published.find(
			(e) => (e as { event: string }).event === "drive.show.planned",
		) as {
			payload?: { scoreReasons?: string[]; title?: string };
		};
		expect(planned.payload?.scoreReasons?.some((r) => r.includes("planner:"))).toBe(
			true,
		);

		const live = getDriveRoomStore().getOrCreateLive("room_plan");
		expect(
			live.director.showBacklog.some(
				(item) => item.produce.templateId === "walk.code",
			),
		).toBe(true);

		ctx.published.length = 0;
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_record_work",
			requestId: "w-cmd",
			payload: {
				roomId: "room_plan",
				work: {
					kind: "command",
					command: "bun test",
					failed: false,
				},
			},
		});
		expect(
			ctx.published.some(
				(e) => (e as { event: string }).event === "drive.show.planned",
			),
		).toBe(false);
	});

	it("call_record_work with showPlannerMode off does not enqueue", async () => {
		resetDriveRoomStoreForTests();
		const store = getDriveRoomStore();
		store.create("room_off");
		const room = store.getOrCreateLive("room_off");
		store.setLive({
			...room,
			director: { ...room.director, showPlannerMode: "off" },
			seatedParticipantIds: ["adam"],
		});

		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_record_work",
			requestId: "w-off",
			payload: {
				roomId: "room_off",
				work: {
					kind: "edit",
					path: "a.ts",
					summary: "x",
				},
			},
		});
		expect(
			ctx.published.some(
				(e) => (e as { event: string }).event === "drive.show.planned",
			),
		).toBe(false);
	});

	it("test_result planner enqueues doc.plan; plan-mode signal via test maps template", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j-test",
			payload: {
				roomId: "room_test_plan",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_record_work",
			requestId: "w-test",
			payload: {
				roomId: "room_test_plan",
				work: {
					kind: "test_result",
					label: "auth",
					passed: true,
					summary: "ok",
				},
			},
		});
		const live = getDriveRoomStore().getOrCreateLive("room_test_plan");
		expect(
			live.director.showBacklog.some(
				(item) => item.produce.templateId === "doc.plan",
			),
		).toBe(true);
	});

	it("call_get_room returns current snapshot; missing room errors", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_join",
			requestId: "j2",
			payload: {
				roomId: "room_get",
				human: { id: "you", displayName: "You" },
				agent: { id: "adam", displayName: "Adam" },
			},
		});
		const got = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_get_room",
			requestId: "g1",
			payload: { roomId: "room_get" },
		});
		expect(got.ok).toBe(true);
		expect(got.payload?.roomId).toBe("room_get");

		const missing = await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_get_room",
			requestId: "g2",
			payload: { roomId: "gone" },
		});
		expect(missing.ok).toBe(false);
		expect(missing.error?.code).toBe("room_not_found");
	});

	it("handoff: join → record work → human pin → agent clears pin", async () => {
		resetDriveRoomStoreForTests();
		const ctx = makeCtx();
		await handleDriveRoomCommand(ctx, {
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
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_record_work",
			requestId: "h1",
			payload: {
				roomId: "room_handoff",
				work: { kind: "edit", path: "a.ts", summary: "diff" },
			},
		});
		await handleDriveRoomCommand(ctx, {
			version: "v1",
			command: "call_record_work",
			requestId: "h2",
			payload: {
				roomId: "room_handoff",
				work: { kind: "command", command: "ls", failed: false },
			},
		});
		const human = await handleDriveRoomCommand(ctx, {
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

		const agent = await handleDriveRoomCommand(ctx, {
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
