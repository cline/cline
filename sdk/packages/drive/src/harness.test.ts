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
			seatSources: ["review-crew"],
		});
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
});
