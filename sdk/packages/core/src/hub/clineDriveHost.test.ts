/**
 * Local DriveHostPort adapter tests (ARD-0013 phase 5).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLINE_HOST_CAPABILITIES, createDriveHarness, runHostConformance } from "@cline/drive";
import { afterEach, describe, expect, it } from "vitest";
import { createClineDriveHost } from "./clineDriveHost";
import { DriveRoomStore } from "./collaboration";

describe("createClineDriveHost", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("passes local capability conformance", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		const host = createClineDriveHost({ configParent: dir, store });
		const report = await runHostConformance(host, {
			localOnly: true,
			remoteBridge: false,
			orgConfig: false,
			auditExport: false,
			promptRewrite: false,
			worktreeIsolation: false,
		});
		expect(report.ok).toBe(true);
	});

	it("advertises only implemented capabilities by default", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const host = createClineDriveHost({
			configParent: dir,
			store: new DriveRoomStore(),
		});
		expect(host.capabilities).toMatchObject({
			...CLINE_HOST_CAPABILITIES,
			promptRewrite: false,
			worktreeIsolation: false,
		});
		await expect(
			host.applyPromptRewrite({ turnId: "t1", rewrite: "x" }),
		).rejects.toThrow(/promptRewrite not advertised/);
	});

	it("advertises promptRewrite only when rewrite fn is wired", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const seen: string[] = [];
		const host = createClineDriveHost({
			configParent: dir,
			store: new DriveRoomStore(),
			promptRewriteFn: async (decision) => {
				seen.push(decision.rewrite);
			},
		});
		expect(host.capabilities.promptRewrite).toBe(true);
		expect(host.capabilities.worktreeIsolation).toBe(false);
		await host.applyPromptRewrite({ turnId: "t1", rewrite: "rewritten" });
		expect(seen).toEqual(["rewritten"]);
	});

	it("commits join through the store + log", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		const host = createClineDriveHost({ configParent: dir, store });
		await host.commitRoomOp({
			type: "create",
			roomId: "r1",
			hostParticipantId: "h1",
		});
		const snap = await host.commitRoomOp({
			type: "join",
			roomId: "r1",
			participant: {
				id: "h1",
				kind: "human",
				displayName: "H",
				role: "host",
				status: "idle",
			},
		});
		expect(snap.participants).toHaveLength(1);
		expect(store.lastSeq("r1")).toBe(1);
	});

	it("createDriveHarness createOrAttach works on the Cline host", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		const host = createClineDriveHost({ configParent: dir, store });
		const drive = createDriveHarness({ host });
		await drive.start();
		const room = await drive.rooms.createOrAttach({
			roomId: "call-1",
			humanId: "drive:human",
			humanDisplayName: "You",
		});
		expect(room.driveActive).toBe(true);
		expect(room.participants).toHaveLength(2);
		expect(await host.getRoom?.("call-1")).toMatchObject({
			roomId: "call-1",
			driveActive: true,
		});
	});

	it("round-trips durable facets", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const host = createClineDriveHost({
			configParent: dir,
			store: new DriveRoomStore(),
		});
		const facets = await host.readDurableFacets(dir);
		expect(facets).toMatchObject({ "runtime.profile": "cloud" });
		await host.writeDurableFacets(dir, facets);
		const again = await host.readDurableFacets(dir);
		expect(again).toMatchObject({ "runtime.profile": "cloud" });
	});

	it("createDriveHarness shows.enqueue commits via DirectorOp", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		const host = createClineDriveHost({ configParent: dir, store });
		const drive = createDriveHarness({ host });
		await drive.rooms.createOrAttach({
			roomId: "show-room",
			humanId: "drive:human",
		});
		const result = await drive.shows.enqueue("show-room", {
			id: "show-1",
			ownerParticipantId: "drive:partner",
			title: "Diagram",
			intent: "Explain",
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			caption: "cap",
			produce: {
				tool: "render_mermaid",
				args: { mermaidSource: "graph TD; A-->B;" },
			},
			priority: 10,
			status: "planned",
			scoreReasons: [],
		});
		expect(result.planned?.id).toBe("show-1");
		const live = result.liveRoom as {
			director: { showBacklog: Array<{ id: string }> };
		};
		expect(live.director.showBacklog.some((item) => item.id === "show-1")).toBe(
			true,
		);
	});

	it("createDriveHarness scripts.attach commits via DirectorOp", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		const host = createClineDriveHost({ configParent: dir, store });
		const drive = createDriveHarness({ host });
		await drive.rooms.createOrAttach({
			roomId: "script-room",
			humanId: "drive:human",
		});
		const showItem = {
			id: "show-script",
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
			scoreReasons: [] as string[],
		};
		const attached = await drive.scripts.attach(
			"script-room",
			{
				scriptId: "s1",
				ownerParticipantId: "drive:partner",
				title: "Hold script",
				stickyShowIds: ["show-script"],
				beats: [
					{
						beatId: "b1",
						say: "First say",
						showItemId: "show-script",
						sticky: { mode: "hold" },
						advance: "on_human",
					},
					{
						beatId: "b2",
						say: "Second say",
						showItemId: "show-script",
						sticky: { mode: "hold" },
						advance: "on_human",
					},
				],
			},
			{ showItems: [showItem] },
		);
		expect(attached.beatId).toBe("b1");
		expect(attached.presented?.id).toBe("show-script");
		const advanced = await drive.scripts.advance("script-room");
		expect(advanced.beatId).toBe("b2");
		expect(advanced.say).toBe("Second say");
		expect(advanced.errorCode).toBeUndefined();
	});
});
