import { describe, expect, it } from "vitest";
import {
	createDriveHarness,
	DRIVE_HARNESS_HUMAN_ID,
	DRIVE_HARNESS_PARTNER_ID,
	memoryDriveHost,
} from "./index";

describe("createDriveHarness", () => {
	it("createOrAttach seats human + partner and activates Drive", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({ host });
		await drive.start();

		const room = await drive.rooms.createOrAttach({
			roomId: "r1",
			humanId: DRIVE_HARNESS_HUMAN_ID,
			humanDisplayName: "You",
		});

		expect(room.driveActive).toBe(true);
		expect(room.subMode).toBe("act");
		expect(room.participants.map((p) => p.id).sort()).toEqual([
			DRIVE_HARNESS_HUMAN_ID,
			DRIVE_HARNESS_PARTNER_ID,
		]);
		expect(room.stage.sharer).toEqual({
			kind: "agent",
			participantId: DRIVE_HARNESS_PARTNER_ID,
		});
	});

	it("createOrAttach honors optional human and partner roles", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({ host });
		const room = await drive.rooms.createOrAttach({
			roomId: "r_roles",
			humanId: "h_obs",
			humanDisplayName: "Observer",
			humanRole: "observer",
			partner: {
				id: "a_rec",
				displayName: "Recorder",
				role: "recorder",
			},
			activateDrive: false,
		});
		expect(room.participants.find((p) => p.id === "h_obs")?.role).toBe(
			"observer",
		);
		expect(room.participants.find((p) => p.id === "a_rec")?.role).toBe(
			"recorder",
		);
	});

	it("createOrAttach preserves seated participants and active room presentation", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({ host });
		await drive.rooms.createOrAttach({
			roomId: "r_attach",
			humanId: "h1",
			humanDisplayName: "Original Human",
			partner: { id: "a1", displayName: "Original Partner" },
		});
		await drive.rooms.setSubMode("r_attach", "debug", true);
		await drive.rooms.setSharer(
			"r_attach",
			{ kind: "human", participantId: "h1" },
			{ kind: "file", label: "Harness", ref: "src/harness.ts" },
		);

		const attached = await drive.rooms.createOrAttach({
			roomId: "r_attach",
			humanId: "h1",
			humanDisplayName: "Replacement Human",
			humanRole: "observer",
			partner: {
				id: "a1",
				displayName: "Replacement Partner",
				role: "recorder",
			},
		});

		expect(attached.participants).toHaveLength(2);
		expect(attached.participants.find((p) => p.id === "h1")).toMatchObject({
			displayName: "Original Human",
			role: "host",
		});
		expect(attached.participants.find((p) => p.id === "a1")).toMatchObject({
			displayName: "Original Partner",
			role: "partner",
		});
		expect(attached.driveActive).toBe(true);
		expect(attached.subMode).toBe("debug");
		expect(attached.stage).toMatchObject({
			sharer: { kind: "human", participantId: "h1" },
			pin: { kind: "file", label: "Harness", ref: "src/harness.ts" },
		});
	});

	it("createOrAttach initializes presentation when attaching activates an inactive room", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({ host });
		await drive.rooms.createOrAttach({
			roomId: "r_inactive",
			humanId: "h1",
			partner: null,
			activateDrive: false,
		});
		await drive.rooms.setSubMode("r_inactive", "debug", false);
		await drive.rooms.setSharer(
			"r_inactive",
			{ kind: "human", participantId: "h1" },
			{ kind: "terminal", label: "Tests" },
		);

		const activated = await drive.rooms.createOrAttach({
			roomId: "r_inactive",
			humanId: "h1",
			partner: { id: "a1", displayName: "Partner" },
		});

		expect(activated.driveActive).toBe(true);
		expect(activated.subMode).toBe("act");
		expect(activated.stage).toMatchObject({
			sharer: { kind: "agent", participantId: "a1" },
			pin: null,
		});
	});

	it("setAddress and setSpotlight go through the host", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({ host });
		await drive.rooms.createOrAttach({
			roomId: "r2",
			humanId: "h1",
			partner: { id: "a1", displayName: "Ada" },
		});

		const addressed = await drive.rooms.setAddress("r2", {
			mode: "agents",
			agentIds: ["a1"],
		});
		expect(addressed.addressSet).toEqual({
			mode: "agents",
			agentIds: ["a1"],
		});

		const spotlight = await drive.rooms.setSpotlight("r2", "h1");
		expect(spotlight.stage.sharer).toEqual({
			kind: "human",
			participantId: "h1",
		});
	});

	it("addRosterPack seats specialists from resolveRosterPack", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({
			host,
			resolveRosterPack: (packId) =>
				packId === "review-crew"
					? [
							{
								id: "reviewer",
								displayName: "Reviewer",
								role: "specialist",
							},
						]
					: [],
		});
		await drive.rooms.createOrAttach({
			roomId: "r3",
			humanId: "h1",
			partner: { id: "partner", displayName: "Partner" },
		});
		const next = await drive.rooms.addRosterPack("r3", "review-crew");
		expect(next.participants.some((p) => p.id === "reviewer")).toBe(true);
		const reviewer = next.participants.find((p) => p.id === "reviewer");
		expect(reviewer).toMatchObject({
			kind: "agent",
			role: "specialist",
			seatSources: [{ kind: "pack", packId: "review-crew" }],
		});
	});

	it("addRosterPack adds a pack source when the member is already seated", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({
			host,
			resolveRosterPack: () => [
				{ id: "partner", displayName: "Partner", role: "partner" },
			],
		});
		await drive.rooms.createOrAttach({
			roomId: "r4",
			humanId: "h1",
			partner: { id: "partner", displayName: "Partner" },
		});
		const next = await drive.rooms.addRosterPack("r4", "pair-pack");
		const partner = next.participants.find((p) => p.id === "partner");
		expect(partner?.kind).toBe("agent");
		if (partner?.kind === "agent") {
			expect(partner.seatSources).toEqual([
				{ kind: "manual" },
				{ kind: "pack", packId: "pair-pack" },
			]);
		}
	});

	it("removeRosterPack keeps overlap and leaves last-source members", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({
			host,
			resolveRosterPack: (packId) => {
				if (packId === "p1") {
					return [
						{ id: "shared", displayName: "Shared", role: "specialist" },
						{ id: "only", displayName: "Only", role: "specialist" },
					];
				}
				if (packId === "p2") {
					return [{ id: "shared", displayName: "Shared", role: "specialist" }];
				}
				return [];
			},
		});
		await drive.rooms.createOrAttach({
			roomId: "r5",
			humanId: "h1",
			partner: null,
			activateDrive: false,
		});
		await drive.rooms.addRosterPack("r5", "p1");
		await drive.rooms.addRosterPack("r5", "p2");
		const afterRemove = await drive.rooms.removeRosterPack("r5", "p1");
		expect(afterRemove.participants.some((p) => p.id === "only")).toBe(false);
		const shared = afterRemove.participants.find((p) => p.id === "shared");
		expect(shared?.kind).toBe("agent");
		if (shared?.kind === "agent") {
			expect(shared.seatSources).toEqual([{ kind: "pack", packId: "p2" }]);
		}
	});

	it("removeRosterPack matches seat tags by pack id or slug alias", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({
			host,
			resolveRosterPack: (packId) => {
				if (packId === "review-crew" || packId === "review") {
					return {
						id: "review",
						slug: "review-crew",
						displayName: "Review",
						members: [{ profileId: "reviewer", role: "specialist" }],
						addressable: true,
					};
				}
				return null;
			},
		});
		await drive.rooms.createOrAttach({
			roomId: "r_alias",
			humanId: "h1",
			partner: null,
			activateDrive: false,
		});
		await drive.rooms.addRosterPack("r_alias", "review-crew");
		const after = await drive.rooms.removeRosterPack("r_alias", "review");
		expect(after.participants.some((p) => p.id === "reviewer")).toBe(false);
	});

	it("exposes pure director helpers without host IO", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({ host });
		const plan = drive.director.planRoute({
			utterance: "please ask Reviewer",
			utteranceId: "u1",
			seated: [
				{
					participantId: "reviewer",
					displayName: "Reviewer",
					role: "specialist",
					labels: ["Reviewer"],
					domains: [],
				},
			],
			mode: "suggest",
		});
		expect(plan.slices.length).toBeGreaterThan(0);
	});

	it("shows.enqueue requires commitDirectorOp on the host", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({ host });
		await expect(
			drive.shows.enqueue("r", {
				id: "s1",
				ownerParticipantId: "a1",
				title: "T",
				intent: "x",
				artifactKind: "doc.plan",
				mediaClass: "document",
				caption: "c",
				produce: {
					tool: "render_plan_card",
					templateId: "doc.plan",
					args: {},
				},
				priority: 1,
				status: "planned",
				scoreReasons: [],
			}),
		).rejects.toThrow(/commitDirectorOp/);
	});

	it("scripts.attach requires commitDirectorOp on the host", async () => {
		const host = memoryDriveHost();
		const drive = createDriveHarness({ host });
		await expect(
			drive.scripts.attach("r", {
				scriptId: "s1",
				ownerParticipantId: "a1",
				title: "Script",
				stickyShowIds: [],
				beats: [
					{
						beatId: "b1",
						say: "hi",
						showItemId: null,
						sticky: { mode: "hold" },
						advance: "on_human",
					},
				],
			}),
		).rejects.toThrow(/commitDirectorOp/);
	});
});
