import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ITelemetryService } from "@cline/shared";
import type { HubLinkDeps } from "./hub/link";
import type { TrayPush } from "./planner/tray/tray";
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
	const start = (
		active: boolean,
		hubLink: HubLinkDeps = offlineHub,
	): SessionRuntime => {
		const runtime = startSessionRuntime(context, {
			settings: () => settings,
			active,
			pluginActive,
			hubLink,
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

/** A running hub the link reaches only `connectMs` after it starts, holding the chat's transcript and status. */
function slowHub(
	connectMs: number,
	transcript: { messages: unknown[]; status: string },
) {
	let connected = false;
	let dropUnder: string | undefined;
	const statusListeners = new Set<(connected: boolean) => void>();
	const commands: string[] = [];
	/** The client's connection changes; `noticed: false` is a drop the link's poll has not seen yet. */
	const setConnected = (next: boolean, noticed = true) => {
		connected = next;
		if (noticed) for (const listener of statusListeners) listener(next);
	};
	const deps: HubLinkDeps = {
		resolveEndpoint: async () => ({ url: "ws://hub.test" }),
		createClient: () => ({
			connect: () =>
				new Promise<void>((resolve) =>
					setTimeout(() => {
						connected = true;
						resolve();
					}, connectMs),
				),
			isConnected: () => connected,
			onStatus: (listener) => {
				statusListeners.add(listener);
				return () => statusListeners.delete(listener);
			},
			subscribe: () => () => {},
			command: async (name) => {
				commands.push(name);
				if (name === dropUnder) {
					dropUnder = undefined;
					setConnected(false);
					throw new Error("the hub connection closed");
				}
				if (name === "session.messages")
					return { messages: transcript.messages };
				if (name === "session.get")
					return { session: { status: transcript.status } };
				return {};
			},
			dispose: async () => {},
		}),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	};
	return {
		deps,
		commands,
		connected: () => connected,
		setConnected,
		/** The connection closes under the next `name` command. */
		dropUnder: (name: string) => {
			dropUnder = name;
		},
	};
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

	describe("a viewer that attaches before the hub link is up", () => {
		function attach(runtime: SessionRuntime) {
			const next = runtime.setViewed(true, "desktop");
			if (!next) throw new Error("no next");
			const pushes: TrayPush["state"][] = [];
			next.onPush((push) => pushes.push(push.state));
			return { next, pushes };
		}

		test("is served the chat's transcript once the link connects", async () => {
			const { start } = harness("cline-desktop");
			const hub = slowHub(50, {
				messages: editRun("Forked chat turn").messages,
				status: "completed",
			});
			const { next, pushes } = attach(start(false, hub.deps));
			const served = next.ensureCurrent();
			expect(hub.connected()).toBe(false);
			await served;
			await next.settled();
			expect(next.current()?.trigger).toBe("on_demand");
			expect(pushes).toEqual(["computing", "ready"]);
		});

		test("is not served a stored last turn while the hub says a run is going", async () => {
			const { start } = harness("cline-desktop");
			const hub = slowHub(50, { messages: [], status: "running" });
			const runtime = start(false, hub.deps);
			runtime.recordDormantTurn(editRun().result);
			const { next, pushes } = attach(runtime);
			await next.ensureCurrent();
			await next.settled();
			expect(hub.commands).toContain("session.get");
			expect(next.current()).toBeUndefined();
			expect(pushes).toEqual([]);
		});

		test("whose client dropped before the link noticed is served once the link comes back", async () => {
			const { start } = harness("cline-desktop");
			const hub = slowHub(0, {
				messages: editRun("Reopened chat turn").messages,
				status: "completed",
			});
			const runtime = start(false, hub.deps);
			await tick(20);
			hub.setConnected(false, false);
			const { next, pushes } = attach(runtime);
			const served = next.ensureCurrent();
			await tick(10);
			hub.setConnected(false);
			hub.setConnected(true);
			await served;
			await next.settled();
			expect(next.current()?.trigger).toBe("on_demand");
			expect(pushes).toEqual(["computing", "ready"]);
		});

		test("is served once the link comes back when it drops under the transcript reads", async () => {
			const { start } = harness("cline-desktop");
			const hub = slowHub(0, {
				messages: editRun("Reopened chat turn").messages,
				status: "completed",
			});
			const runtime = start(false, hub.deps);
			await tick(20);
			hub.dropUnder("session.messages");
			const { next, pushes } = attach(runtime);
			const served = next.ensureCurrent();
			await tick(10);
			hub.setConnected(true);
			await served;
			await next.settled();
			expect(
				hub.commands.filter((name) => name === "session.messages"),
			).toHaveLength(2);
			expect(next.current()?.trigger).toBe("on_demand");
			expect(pushes).toEqual(["computing", "ready"]);
		});

		test("with no hub running, is served the stored last turn without waiting", async () => {
			const { start } = harness("cline-desktop");
			const runtime = start(false);
			runtime.recordDormantTurn(editRun().result);
			const { next, pushes } = attach(runtime);
			const startedAt = Date.now();
			await next.ensureCurrent();
			await next.settled();
			expect(Date.now() - startedAt).toBeLessThan(1_000);
			expect(next.current()?.trigger).toBe("on_demand");
			expect(pushes).toEqual(["computing", "ready"]);
		});
	});
});
