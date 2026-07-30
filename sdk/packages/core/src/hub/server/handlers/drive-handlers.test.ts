import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDriveRoomStore } from "../../collaboration";
import type { HubTransportContext } from "./context";
import {
	__resetDriveRoomsForTests,
	handleDriveCommand,
} from "./drive-handlers";

function envelope(
	command: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		command,
		requestId: "req-1",
		payload,
	};
}

function createCtx() {
	const published: HubEventEnvelope[] = [];
	const ctx = {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionHost: {} as HubTransportContext["sessionHost"],
		publish: (event: HubEventEnvelope) => {
			published.push(event);
		},
		buildEvent: (
			event: HubEventEnvelope["event"],
			payload?: Record<string, unknown>,
		) =>
			({
				version: "v1",
				event,
				payload,
			}) as unknown as HubEventEnvelope,
		requestCapability: vi.fn(),
	} as unknown as HubTransportContext;
	return { ctx, published };
}

describe("handleDriveCommand", () => {
	beforeEach(() => {
		__resetDriveRoomsForTests();
	});

	it("gets an empty room", async () => {
		const { ctx } = createCtx();
		const reply = await handleDriveCommand(
			ctx,
			envelope("drive.room.get", { roomId: "r1" }),
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.room).toMatchObject({
			roomId: "r1",
			version: 0,
		});
	});

	it("sets spotlight and broadcasts", async () => {
		const { ctx, published } = createCtx();
		const reply = await handleDriveCommand(
			ctx,
			envelope("drive.spotlight.set", {
				roomId: "r1",
				participantId: "agent-1",
				reason: "human",
			}),
		);
		expect(reply.ok).toBe(true);
		expect(
			published.some((event) => event.event === "drive.room.changed"),
		).toBe(true);
		expect(
			published.some((event) => event.event === "drive.spotlight.changed"),
		).toBe(true);
		const room = reply.payload?.room as {
			spotlightParticipantId: string;
		};
		expect(room.spotlightParticipantId).toBe("agent-1");
		const snapshot = reply.payload?.snapshot as {
			stage: { sharer: { participantId: string; kind: string } | null };
		};
		expect(snapshot.stage.sharer).toEqual({
			kind: "agent",
			participantId: "agent-1",
		});
	});

	it("toggles mute independently of deafen", async () => {
		const { ctx } = createCtx();
		await handleDriveCommand(
			ctx,
			envelope("drive.participant.mute.set", {
				roomId: "r1",
				participantId: "agent-1",
				muted: true,
			}),
		);
		const reply = await handleDriveCommand(
			ctx,
			envelope("drive.participant.deafen.set", {
				roomId: "r1",
				participantId: "agent-1",
				deafened: true,
			}),
		);
		expect(reply.ok).toBe(true);
		const room = reply.payload?.room as {
			participantAudio: Array<{ muted: boolean; deafened: boolean }>;
		};
		expect(room.participantAudio[0]).toMatchObject({
			muted: true,
			deafened: true,
		});
	});

	it("materializes mermaid show items without uri", async () => {
		const { ctx, published } = createCtx();
		const reply = await handleDriveCommand(
			ctx,
			envelope("drive.show.present", {
				roomId: "r1",
				showItem: {
					id: "show-1",
					ownerParticipantId: "drive:partner",
					title: "Flow",
					intent: "Explain",
					artifactKind: "diagram.architecture",
					mediaClass: "still",
					caption: "Flow diagram",
					produce: {
						tool: "render_mermaid",
						args: { mermaidSource: "graph TD; A-->B;" },
					},
					priority: 1,
					status: "planned",
					scoreReasons: [],
				},
			}),
		);
		expect(reply.ok).toBe(true);
		const room = reply.payload?.room as {
			director: {
				activeShowId: string;
				showBacklog: Array<{ uri?: string; title?: string }>;
			};
		};
		expect(room.director.activeShowId).toBe("show-1");
		expect(room.director.showBacklog[0]?.uri).toMatch(/^data:image\/svg\+xml/);
		expect(room.director.showBacklog[0]?.title).toBe("Flow");
		const presented = published.find(
			(event) => event.event === "drive.show.presented",
		);
		expect(presented?.payload).toMatchObject({
			showItemId: "show-1",
			title: "Flow",
			caption: "Flow diagram",
		});
		expect(
			typeof (presented?.payload as { uri?: string } | undefined)?.uri,
		).toBe("string");
	});

	it("fails closed when mermaidSource is not parse-valid", async () => {
		const { ctx, published } = createCtx();
		const reply = await handleDriveCommand(
			ctx,
			envelope("drive.show.present", {
				roomId: "r1",
				showItem: {
					id: "show-bad",
					ownerParticipantId: "drive:partner",
					title: "Bad",
					intent: "Explain",
					artifactKind: "diagram.architecture",
					mediaClass: "still",
					caption: "Invalid",
					produce: {
						tool: "render_mermaid",
						args: { mermaidSource: "not a real diagram" },
					},
					priority: 1,
					status: "planned",
					scoreReasons: [],
				},
			}),
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("mermaid_parse_failed");
		expect(
			published.some((event) => event.event === "drive.show.presented"),
		).toBe(false);
	});

	it("enqueues without presenting, then tick presents higher priority", async () => {
		const { ctx, published } = createCtx();
		const low = {
			id: "show-low",
			ownerParticipantId: "drive:partner",
			title: "Low",
			intent: "Explain",
			artifactKind: "diagram.architecture" as const,
			mediaClass: "still" as const,
			caption: "low",
			produce: {
				tool: "render_mermaid",
				args: { mermaidSource: "graph TD; L-->Z;" },
			},
			priority: 1,
			status: "planned" as const,
			scoreReasons: [],
		};
		const high = {
			...low,
			id: "show-high",
			title: "High",
			caption: "high",
			priority: 50,
			produce: {
				tool: "render_mermaid",
				args: { mermaidSource: "graph TD; H-->Z;" },
			},
		};

		const enqueueLow = await handleDriveCommand(
			ctx,
			envelope("drive.show.enqueue", { roomId: "r1", showItem: low }),
		);
		expect(enqueueLow.ok).toBe(true);
		const enqueueHigh = await handleDriveCommand(
			ctx,
			envelope("drive.show.enqueue", { roomId: "r1", showItem: high }),
		);
		expect(enqueueHigh.ok).toBe(true);
		expect(
			published.some((event) => event.event === "drive.show.planned"),
		).toBe(true);
		const roomAfterEnqueue = enqueueHigh.payload?.room as {
			director: { activeShowId: string | null; showBacklog: unknown[] };
		};
		expect(roomAfterEnqueue.director.activeShowId).toBeNull();
		expect(roomAfterEnqueue.director.showBacklog).toHaveLength(2);

		const tick = await handleDriveCommand(
			ctx,
			envelope("drive.show.tick", { roomId: "r1" }),
		);
		expect(tick.ok).toBe(true);
		const room = tick.payload?.room as {
			director: {
				activeShowId: string;
				showBacklog: Array<{ id: string; uri?: string; status: string }>;
			};
		};
		expect(room.director.activeShowId).toBe("show-high");
		expect(room.director.showBacklog[0]?.uri).toMatch(/^data:image\/svg\+xml/);
		expect(room.director.showBacklog[0]?.status).toBe("showing");
		expect(
			published.some((event) => event.event === "drive.show.presented"),
		).toBe(true);
	});

	it("tick is a no-op when backlog is empty", async () => {
		const { ctx } = createCtx();
		const tick = await handleDriveCommand(
			ctx,
			envelope("drive.show.tick", { roomId: "empty" }),
		);
		expect(tick.ok).toBe(true);
		expect(tick.payload?.presented).toBeNull();
	});

	it("enqueue with presentNow presents immediately", async () => {
		const { ctx, published } = createCtx();
		const reply = await handleDriveCommand(
			ctx,
			envelope("drive.show.enqueue", {
				roomId: "r2",
				presentNow: true,
				showItem: {
					id: "show-now",
					ownerParticipantId: "drive:partner",
					title: "Now",
					intent: "Explain",
					artifactKind: "diagram.architecture",
					mediaClass: "still",
					caption: "now",
					produce: {
						tool: "render_mermaid",
						args: { mermaidSource: "graph TD; N-->Z;" },
					},
					priority: 10,
					status: "planned",
					scoreReasons: [],
				},
			}),
		);
		expect(reply.ok).toBe(true);
		const room = reply.payload?.room as {
			director: { activeShowId: string };
		};
		expect(room.director.activeShowId).toBe("show-now");
		expect(
			published.some((event) => event.event === "drive.show.presented"),
		).toBe(true);
	});

	it("attach sample hold script then advance updates say while keeping show", async () => {
		const { ctx, published } = createCtx();
		const showItem = {
			id: "show-hold",
			ownerParticipantId: "drive:partner",
			title: "Hold",
			intent: "Explain",
			artifactKind: "diagram.architecture" as const,
			mediaClass: "still" as const,
			caption: "diagram",
			produce: {
				tool: "render_mermaid",
				args: { mermaidSource: "graph TD; A-->B;" },
			},
			priority: 10,
			status: "ready" as const,
			scoreReasons: [],
		};
		const attach = await handleDriveCommand(
			ctx,
			envelope("drive.script.attach", {
				roomId: "r-script",
				showItems: [showItem],
				script: {
					scriptId: "s1",
					ownerParticipantId: "drive:partner",
					title: "Hold script",
					stickyShowIds: ["show-hold"],
					beats: [
						{
							beatId: "b1",
							say: "First say",
							showItemId: "show-hold",
							sticky: { mode: "hold" },
							advance: "on_human",
						},
						{
							beatId: "b2",
							say: "Second say",
							showItemId: "show-hold",
							sticky: { mode: "hold" },
							advance: "on_human",
						},
					],
				},
			}),
		);
		expect(attach.ok).toBe(true);
		expect(attach.payload?.beatId).toBe("b1");
		const advance = await handleDriveCommand(
			ctx,
			envelope("drive.script.advance", { roomId: "r-script" }),
		);
		expect(advance.ok).toBe(true);
		expect(advance.payload?.beatId).toBe("b2");
		expect(advance.payload?.say).toBe("Second say");
		const room = advance.payload?.room as {
			director: { activeShowId: string; activeBeatId: string };
		};
		expect(room.director.activeShowId).toBe("show-hold");
		expect(room.director.activeBeatId).toBe("b2");
		const beats = published.filter((event) => event.event === "drive.script.beat");
		expect(beats.length).toBeGreaterThanOrEqual(2);
		expect(beats.at(-1)?.payload).toMatchObject({
			beatId: "b2",
			say: "Second say",
			showItemId: "show-hold",
		});
	});

	it("blocks script say when the speaker is muted", async () => {
		const { ctx, published } = createCtx();
		await handleDriveCommand(
			ctx,
			envelope("drive.participant.mute.set", {
				roomId: "r-mute-say",
				participantId: "drive:partner",
				muted: true,
			}),
		);
		const attach = await handleDriveCommand(
			ctx,
			envelope("drive.script.attach", {
				roomId: "r-mute-say",
				showItems: [
					{
						id: "show-mute",
						ownerParticipantId: "drive:partner",
						title: "Mute",
						intent: "Explain",
						artifactKind: "diagram.architecture",
						mediaClass: "still",
						caption: "diagram",
						produce: {
							tool: "render_mermaid",
							args: { mermaidSource: "graph TD; A-->B;" },
						},
						priority: 10,
						status: "ready",
						scoreReasons: [],
					},
				],
				script: {
					scriptId: "s-mute",
					ownerParticipantId: "drive:partner",
					title: "Muted script",
					stickyShowIds: ["show-mute"],
					beats: [
						{
							beatId: "b1",
							say: "Should not speak",
							showItemId: "show-mute",
							sticky: { mode: "hold" },
							advance: "on_human",
						},
					],
				},
			}),
		);
		expect(attach.ok).toBe(true);
		const beats = published.filter((event) => event.event === "drive.script.beat");
		expect(beats.at(-1)?.payload).toMatchObject({
			beatId: "b1",
			say: "",
			deliveryBlocked: "sender_muted",
		});
	});

	it("enqueues a Do backlog item onto the room director", async () => {
		const { ctx, published } = createCtx();
		const reply = await handleDriveCommand(
			ctx,
			envelope("drive.do.enqueue", {
				roomId: "r-do",
				doItem: {
					id: "do-auth",
					title: "Fix auth flake",
					goal: "Stabilize login test",
					priority: 20,
					status: "active",
					dependsOn: [],
					source: "human",
				},
			}),
		);
		expect(reply.ok).toBe(true);
		const room = reply.payload?.room as {
			director: { doBacklog: Array<{ id: string; status: string; title: string }> };
		};
		expect(room.director.doBacklog).toEqual([
			expect.objectContaining({
				id: "do-auth",
				title: "Fix auth flake",
				status: "queued",
			}),
		]);
		expect(
			published.some((event) => event.event === "drive.room.changed"),
		).toBe(true);

		const upsert = await handleDriveCommand(
			ctx,
			envelope("drive.do.enqueue", {
				roomId: "r-do",
				doItem: {
					id: "do-auth",
					title: "Fix auth flake (updated)",
					goal: "Stabilize login test",
					priority: 30,
					status: "queued",
					dependsOn: [],
					source: "planner",
				},
			}),
		);
		expect(upsert.ok).toBe(true);
		const next = upsert.payload?.room as {
			director: { doBacklog: Array<{ id: string; title: string; priority: number }> };
		};
		expect(next.director.doBacklog).toHaveLength(1);
		expect(next.director.doBacklog[0]).toMatchObject({
			id: "do-auth",
			title: "Fix auth flake (updated)",
			priority: 30,
		});
	});

	it("sets show planner knobs on the room director", async () => {
		const { ctx } = createCtx();
		const reply = await handleDriveCommand(
			ctx,
			envelope("drive.planner.set", {
				roomId: "r-plan",
				showPlannerMode: "off",
				tickOnWork: false,
				showPlannerCooldownMs: 60_000,
			}),
		);
		expect(reply.ok).toBe(true);
		const room = reply.payload?.room as {
			director: {
				showPlannerMode: string;
				tickOnWork: boolean;
				showPlannerCooldownMs: number;
			};
		};
		expect(room.director.showPlannerMode).toBe("off");
		expect(room.director.tickOnWork).toBe(false);
		expect(room.director.showPlannerCooldownMs).toBe(60_000);
	});

	it("materializes plan_card and walkthrough on tick", async () => {
		const { ctx } = createCtx();
		await handleDriveCommand(
			ctx,
			envelope("drive.show.enqueue", {
				roomId: "r-prod",
				showItem: {
					id: "show-plan",
					ownerParticipantId: "agent-1",
					title: "Plan",
					intent: "plan",
					artifactKind: "doc.plan",
					mediaClass: "document",
					caption: "plan",
					produce: { tool: "render_plan_card", templateId: "doc.plan", args: {} },
					priority: 30,
					status: "ready",
					scoreReasons: [],
				},
			}),
		);
		const tick = await handleDriveCommand(
			ctx,
			envelope("drive.show.tick", { roomId: "r-prod" }),
		);
		expect(tick.ok).toBe(true);
		const room = tick.payload?.room as {
			director: {
				activeShowId: string;
				showBacklog: Array<{ uri?: string; status: string }>;
			};
		};
		expect(room.director.activeShowId).toBe("show-plan");
		expect(room.director.showBacklog[0]?.uri).toMatch(/^data:image\/svg\+xml/);
		expect(room.director.showBacklog[0]?.status).toBe("showing");
	});

	it("skips browser snapshot without demoCapture and leaves backlog planned", async () => {
		const { ctx } = createCtx();
		await handleDriveCommand(
			ctx,
			envelope("drive.show.enqueue", {
				roomId: "r-shot",
				showItem: {
					id: "show-shot",
					ownerParticipantId: "agent-1",
					title: "Shot",
					intent: "ui",
					artifactKind: "capture.screenshot",
					mediaClass: "still",
					caption: "shot",
					produce: {
						tool: "drive_browser_snapshot",
						templateId: "capture.shot",
						args: { url: "http://localhost" },
					},
					priority: 50,
					status: "ready",
					scoreReasons: [],
				},
			}),
		);
		const tick = await handleDriveCommand(
			ctx,
			envelope("drive.show.tick", { roomId: "r-shot" }),
		);
		expect(tick.ok).toBe(true);
		expect(tick.payload?.presented).toBeNull();
	});

	it("show tick prefers addressed owner when priorities tie", async () => {
		const { ctx } = createCtx();
		getDriveRoomStore().create("r-addr");
		getDriveRoomStore().setAddress({
			roomId: "r-addr",
			addressSet: { mode: "agents", agentIds: ["agent-b"] },
		});
		const baseShow = {
			title: "Tie",
			intent: "x",
			artifactKind: "doc.plan" as const,
			mediaClass: "document" as const,
			caption: "c",
			produce: {
				tool: "render_plan_card",
				templateId: "doc.plan",
				args: {},
			},
			priority: 10,
			status: "ready" as const,
			scoreReasons: [] as string[],
		};
		await handleDriveCommand(
			ctx,
			envelope("drive.show.enqueue", {
				roomId: "r-addr",
				showItem: {
					...baseShow,
					id: "show-a",
					ownerParticipantId: "agent-a",
				},
			}),
		);
		await handleDriveCommand(
			ctx,
			envelope("drive.show.enqueue", {
				roomId: "r-addr",
				showItem: {
					...baseShow,
					id: "show-b",
					ownerParticipantId: "agent-b",
				},
			}),
		);
		const tick = await handleDriveCommand(
			ctx,
			envelope("drive.show.tick", { roomId: "r-addr" }),
		);
		expect(tick.ok).toBe(true);
		const room = tick.payload?.room as {
			director: { activeShowId: string };
		};
		expect(room.director.activeShowId).toBe("show-b");
	});
});
