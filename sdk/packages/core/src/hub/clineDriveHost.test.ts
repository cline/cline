/**
 * Local DriveHostPort adapter tests (ARD-0013 phase 5).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHostConformance } from "@cline/drive";
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
		});
		expect(report.ok).toBe(true);
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
