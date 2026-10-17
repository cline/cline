import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ITelemetryService } from "@cline/shared";
import {
	type SessionRuntime,
	type SetupContext,
	startSessionRuntime,
} from "./runtime";
import { defaultSettings, type Settings } from "./settings/settings";
import { nextTurnPaths } from "./store/data-dir";
import { FileSessionStateStore } from "./store/session-state";
import { editRun, message } from "./test-support/agent-runs";
import {
	flushDetached,
	noCommands,
	offlineHub,
} from "./test-support/plugin-host";
import { useTempDirs } from "./test-support/temp-dirs";

const tempDir = useTempDirs("next-turn-runtime-");

const running: SessionRuntime[] = [];
afterEach(async () => {
	await Promise.all(running.splice(0).map((runtime) => runtime.stop()));
});

let sessions = 0;

function harness(clientName = "cline-cli", pluginActive?: () => boolean) {
	sessions += 1;
	const sessionId = `sess_runtime_${sessions}`;
	const settings: Settings = defaultSettings();
	settings.notify.needsYou = false;
	settings.planner.callsPerHour = 0;
	const surfaces: unknown[] = [];
	const telemetry = {
		capture: (event: { properties?: Record<string, unknown> }) => {
			surfaces.push(event.properties?.surface);
		},
		recordCounter: () => {},
		recordHistogram: () => {},
	} as unknown as ITelemetryService;
	const context: SetupContext = {
		session: { sessionId },
		client: { name: clientName },
		workspaceInfo: { rootPath: tempDir() },
		telemetry,
	};
	const start = (active: boolean): SessionRuntime => {
		const runtime = startSessionRuntime(context, {
			settings: () => settings,
			active,
			pluginActive,
			hubLink: offlineHub,
			runCommand: noCommands,
		});
		if (!runtime) throw new Error("no runtime");
		running.push(runtime);
		return runtime;
	};
	const stored = () =>
		new FileSessionStateStore(nextTurnPaths().sessions, sessionId).read();
	return { sessionId, settings, surfaces, start, stored };
}

/** Lets connector detection, started with Next, finish. */
async function detected(runtime: SessionRuntime): Promise<void> {
	await runtime.connectors?.detect();
	await flushDetached();
}

describe("one chat's runtime and its viewer", () => {
	test("a runtime that never waits for a viewer is viewed from the start and stores no viewer", async () => {
		const { start, stored } = harness();
		const runtime = start(true);
		expect(runtime.viewed()).toBe(true);
		expect(runtime.next).toBeDefined();
		await runtime.next?.afterRun(editRun().result);
		expect(stored()?.viewerSurface).toBeUndefined();
	});

	test("an attach stores the viewer's surface, a detach clears it and pauses the refresher without stopping Next, and a second attach restores both", async () => {
		const { start, stored } = harness();
		const runtime = start(false);
		expect([runtime.viewed(), runtime.next]).toEqual([false, undefined]);
		const next = runtime.setViewed(true, "desktop");
		expect(next).toBeDefined();
		expect(stored()?.viewerSurface).toBe("desktop");
		await detected(runtime);
		const refresher = runtime.connectors?.refresher;
		if (!refresher) throw new Error("no refresher");
		const starts = spyOn(refresher, "start");
		const stops = spyOn(refresher, "stop");

		expect(runtime.setViewed(false)).toBe(next);
		expect([runtime.viewed(), stored()?.viewerSurface]).toEqual([
			false,
			undefined,
		]);
		expect([starts.mock.calls.length, stops.mock.calls.length]).toEqual([0, 1]);
		expect(runtime.next).toBe(next);

		expect(runtime.setViewed(true)).toBe(next);
		expect(stored()?.viewerSurface).toBe("desktop");
		expect(starts.mock.calls.length).toBe(1);
	});

	test("a respawn of a viewed chat starts Next at once, and of a chat whose viewer left stays dormant", async () => {
		const { sessionId, start, stored } = harness();
		const viewed = start(false);
		viewed.setViewed(true, "desktop");
		const respawned = start(false);
		expect([respawned.viewed(), respawned.next !== undefined]).toEqual([
			true,
			true,
		]);

		respawned.setViewed(false);
		const { result } = editRun();
		expect(await respawned.next?.afterRun(result)).toBeUndefined();
		expect(stored()?.viewerSurface).toBeUndefined();
		expect(stored()?.lastTurn?.turnKey).toBe(`${sessionId}:1`);
		const dormant = start(false);
		expect([dormant.viewed(), dormant.next]).toEqual([false, undefined]);
	});

	test("a dormant turn stores the viewer only while one is attached", () => {
		const { settings, start, stored } = harness();
		const runtime = start(false);
		settings.features.next = false;
		expect(runtime.setViewed(true, "vscode")).toBeUndefined();
		settings.features.next = true;
		runtime.recordDormantTurn(editRun().result);
		expect(stored()?.viewerSurface).toBe("vscode");
		runtime.setViewed(false);
		runtime.recordDormantTurn(editRun("Another turn").result);
		expect(stored()?.viewerSurface).toBeUndefined();
		expect(stored()?.lastTurn).toBeDefined();
		expect(start(false).next).toBeUndefined();
	});

	test("the viewer mark an earlier version stored is read once and kept as a surface", () => {
		for (const [viewerClient, viewerSurface] of [
			["cline-cli", "cli"],
			["cline-desktop", "desktop"],
			["cline-vscode", "other"],
		]) {
			const { sessionId, start, stored } = harness();
			new FileSessionStateStore(nextTurnPaths().sessions, sessionId).write({
				seq: 2,
				viewerClient,
			});
			const migrated = start(false);
			expect([migrated.viewed(), migrated.next !== undefined]).toEqual([
				true,
				true,
			]);
			expect(stored()).toMatchObject({ seq: 2, viewerSurface });
			expect(stored()?.viewerClient).toBeUndefined();
			expect(start(false).next).toBeDefined();
		}
	});

	test("a viewer that attaches while the plugin is disabled is stored without starting Next, which starts once the plugin is enabled", () => {
		let enabled = false;
		const { start, stored } = harness("cline-desktop", () => enabled);
		const runtime = start(false);
		expect(runtime.setViewed(true, "desktop")).toBeUndefined();
		expect([runtime.viewed(), runtime.next]).toEqual([true, undefined]);
		expect(stored()?.viewerSurface).toBe("desktop");
		enabled = true;
		expect(runtime.setViewed(true)).toBeDefined();
		expect(runtime.next).toBeDefined();
	});

	test("connector detection that finishes after the viewer left does not start the refresher", async () => {
		const { start } = harness();
		const runtime = start(false);
		runtime.setViewed(true, "desktop");
		const refresher = runtime.connectors?.refresher;
		if (!refresher) throw new Error("no refresher");
		const starts = spyOn(refresher, "start");
		runtime.setViewed(false);
		await detected(runtime);
		expect(starts).not.toHaveBeenCalled();
	});

	test("labels name the last viewer's tray, and a chat no viewer attached to keeps its client's", async () => {
		for (const [client, surface] of [
			["cline-cli", "terminal-tray"],
			["cline-desktop", "desktop-tray"],
			["cline-vscode", "plugin"],
		]) {
			const unviewed = harness(client);
			await unviewed.start(true).next?.afterRun(editRun().result);
			expect(unviewed.surfaces.length).toBeGreaterThan(0);
			expect([client, new Set(unviewed.surfaces)]).toEqual([
				client,
				new Set([surface]),
			]);
		}

		const viewed = harness("cline-cli");
		const runtime = viewed.start(false);
		const next = runtime.setViewed(true, "desktop");
		const run = editRun();
		await next?.afterRun(run.result);
		runtime.setViewed(false);
		viewed.surfaces.splice(0);
		next?.outgoing([...run.messages, message("user", "Now the parser")]);
		expect(viewed.surfaces.length).toBeGreaterThan(0);
		expect(new Set(viewed.surfaces)).toEqual(new Set(["desktop-tray"]));
	});
});
