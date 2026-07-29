import { describe, expect, it } from "vitest";
import { readDrivecodeDemoCliBootstrap } from "./cli-env";
import { DrivePlansDemoStatusSnapshotSource } from "./drive-plans-demo-status-source";
import { readDrivecodeDemoHubBootstrap } from "./hub-query";

describe("DrivePlansDemoStatusSnapshotSource", () => {
	it("load() returns non-empty board updates and plan teams", async () => {
		const source = new DrivePlansDemoStatusSnapshotSource();
		const snap = await source.load();
		expect(snap.updates.length).toBeGreaterThan(0);
		expect(snap.teams.length).toBeGreaterThan(0);
		expect(snap.summary).toBeNull();
		expect(snap.teams[0]?.tasks.length).toBeGreaterThan(0);
	});
});

describe("readDrivecodeDemoCliBootstrap", () => {
	it("defaults to demos off when env is empty", () => {
		const boot = readDrivecodeDemoCliBootstrap({});
		expect(boot).toEqual({
			useDemoStatusAdapter: false,
			statusInitialLens: undefined,
			autoOpenStatus: false,
			driveActiveOnStart: false,
		});
	});

	it("parses CLI demo env flags", () => {
		const boot = readDrivecodeDemoCliBootstrap({
			CLINE_DEMO_STATUS_PLANS: "1",
			CLINE_DEMO_STATUS_LENS: "dependency-map",
			CLINE_DEMO_OPEN_STATUS: "1",
			CLINE_DEMO_DRIVE: "1",
		});
		expect(boot).toEqual({
			useDemoStatusAdapter: true,
			statusInitialLens: "dependency-map",
			autoOpenStatus: true,
			driveActiveOnStart: true,
		});
	});

	it("ignores unknown status lens values", () => {
		const boot = readDrivecodeDemoCliBootstrap({
			CLINE_DEMO_STATUS_LENS: "changelog",
		});
		expect(boot.statusInitialLens).toBeUndefined();
	});
});

describe("readDrivecodeDemoHubBootstrap", () => {
	it("defaults to demos off when search is empty", () => {
		expect(readDrivecodeDemoHubBootstrap()).toEqual({
			useDemoTeamsAdapter: false,
			initialStatusMode: undefined,
		});
	});

	it("parses demoPlans and statusMode from a query string", () => {
		const boot = readDrivecodeDemoHubBootstrap(
			"?demoPlans=1&statusMode=dependency-map",
		);
		expect(boot).toEqual({
			useDemoTeamsAdapter: true,
			initialStatusMode: "dependency-map",
		});
	});

	it("accepts URLSearchParams and board/changelog modes", () => {
		const params = new URLSearchParams({
			demoPlans: "1",
			statusMode: "changelog",
		});
		expect(readDrivecodeDemoHubBootstrap(params)).toEqual({
			useDemoTeamsAdapter: true,
			initialStatusMode: "changelog",
		});
	});

	it("ignores unknown statusMode values", () => {
		expect(
			readDrivecodeDemoHubBootstrap("demoPlans=0&statusMode=nope").initialStatusMode,
		).toBeUndefined();
	});
});
