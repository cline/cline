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
});
