import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Agent } from "@cline/core";
import { Refresher } from "./connectors/refresher";
import { PluginLifecycle } from "./lifecycle";
import { EMPTY_BACKLOG } from "./planner/backlog";
import { LabelLog } from "./planner/labels/labels";
import { NextSession } from "./planner/session/session";
import { createNextTurnPlugin } from "./plugin";
import {
	type SessionRuntime,
	type SetupContext,
	sessionEnv,
	startSessionRuntime,
} from "./runtime";
import { defaultSettings } from "./settings/settings";
import { FileSessionStateStore } from "./store/session-state";
import { editorTool, editRun } from "./test-support/agent-runs";
import {
	agentFor,
	cliSetupContext,
	fakeRuntime,
	fakeSlotHost,
	noCommands,
	offlineHub,
	presence,
	slotContext,
} from "./test-support/plugin-host";
import { useTempDirs } from "./test-support/temp-dirs";

const tempDir = useTempDirs("next-turn-lifecycle-");

describe("plugin lifecycle: disable and uninstall in open chats", () => {
	test("goes quiet when disabledPlugins lists its entry or the package root is removed, and resumes when re-enabled", async () => {
		const dir = tempDir();
		const pkgRoot = join(dir, "pkg");
		const distDir = join(pkgRoot, "dist");
		mkdirSync(distDir, { recursive: true });
		const entryPath = join(distDir, "index.js");
		writeFileSync(
			join(pkgRoot, "package.json"),
			JSON.stringify({ name: "next-turn" }),
		);
		writeFileSync(entryPath, "");

		const settingsPath = join(dir, "global-settings.json");
		writeFileSync(settingsPath, JSON.stringify({ disabledPlugins: [] }));

		const lifecycle = new PluginLifecycle({
			settingsPath,
			packageRoot: pkgRoot,
			entryPaths: [entryPath],
		});
		expect(lifecycle.active()).toBe(true);

		const labelsPath = join(dir, "labels.jsonl");
		let plannerCalls = 0;
		const host = fakeSlotHost();
		const context: SetupContext = {
			session: { sessionId: "sess_life" },
			client: { name: "cline-desktop" },
			workspaceInfo: { rootPath: dir },
		};
		const next = new NextSession({
			sessionId: "sess_life",
			settings: defaultSettings,
			env: sessionEnv(context, { tools: () => [] }),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
			complete: async () => {
				plannerCalls += 1;
				return {
					text: '{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run tests.","why":"changed"}]}',
				};
			},
			labels: new LabelLog(labelsPath),
		});
		const plugin = createNextTurnPlugin({
			startRuntime: () => fakeRuntime(next),
			lifecycle,
		});
		await plugin.setup?.(host.api as never, { ...context, ui: host.ui });

		writeFileSync(
			settingsPath,
			JSON.stringify({ disabledPlugins: [entryPath] }),
		);
		utimesSync(settingsPath, new Date(), new Date(Date.now() + 2_000));

		const model = {
			async *stream() {
				yield { type: "text-delta" as const, text: "Done." };
				yield { type: "finish" as const, reason: "stop" as const };
			},
		};
		const agent = new Agent({
			model,
			tools: [editorTool],
			hooks: plugin.hooks,
		});
		await agent.run("Turn while disabled");
		await next.settled();

		expect(plannerCalls).toBe(0);
		expect(() => readFileSync(labelsPath)).toThrow();
		expect(
			host.states.map((state) => [state?.status, state?.hiddenReason]),
		).toEqual([["hidden", "disabled"]]);
		expect(host.invoke({ verb: "attach", surface: "desktop" })).toEqual({
			outcome: "ok",
		});
		expect(host.latest()).toMatchObject({
			status: "hidden",
			hiddenReason: "disabled",
			title: "Next",
		});

		writeFileSync(settingsPath, JSON.stringify({ disabledPlugins: [] }));
		utimesSync(settingsPath, new Date(), new Date(Date.now() + 5_000));

		await agent.run("Turn after re-enabling");
		await next.settled();
		expect(plannerCalls).toBe(1);
		expect(next.current()?.candidates.length).toBeGreaterThan(0);

		rmSync(pkgRoot, { recursive: true, force: true });
		expect(lifecycle.active()).toBe(false);
	});

	test("a disable no hook has seen yet stops a late planner answer and the connector tick", async () => {
		const dir = tempDir();
		let enabled = true;
		let release: () => void = () => {};
		const answered = new Promise<void>((resolve) => {
			release = resolve;
		});
		const labelsPath = join(dir, "labels.jsonl");
		const next = new NextSession({
			sessionId: "sess_quiet",
			settings: defaultSettings,
			env: () => ({ client: "cline-cli", tools: [] }),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
			complete: async () => {
				await answered;
				return {
					text: '{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run tests.","why":"changed"}]}',
				};
			},
			labels: new LabelLog(labelsPath),
			active: () => enabled,
		});
		const planners: (string | undefined)[] = [];
		next.onPush((push) => planners.push(push.set?.planner));
		await next.afterRun(editRun().result);
		enabled = false;
		release();
		await next.settled();
		expect(planners).toEqual([undefined]);
		expect(existsSync(labelsPath)).toBe(false);

		const read: string[] = [];
		let tick: () => void = () => {};
		enabled = true;
		const refresher = new Refresher({
			connectors: () => [
				{
					id: "github",
					tier: "T3",
					scopes: [{ id: "pr", label: "PR", everyMinutes: 5 }],
					probe: () => "present",
					refresh: async (scope) => {
						read.push(scope);
					},
				},
			],
			access: () => ({ role: "read", scopes: ["pr"], readAllowed: true }),
			env: () => ({ tools: [] }),
			active: () => enabled,
			now: () => (enabled ? 0 : 10 * 60_000),
			startTicking: (run) => {
				tick = run;
				return () => {};
			},
		});
		await refresher.start();
		enabled = false;
		tick();
		await Bun.sleep(0);
		expect(read).toEqual(["pr"]);
	});

	test("a chat set up while the plugin is disabled answers an attach with a disabled tray, not the saved set", async () => {
		const dir = tempDir();
		const makeSession = () =>
			new NextSession({
				sessionId: "sess_disabled",
				settings: defaultSettings,
				env: () => ({ client: "cline-desktop", tools: [] }),
				sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
				backlog: async () => EMPTY_BACKLOG,
				store: new FileSessionStateStore(dir, "sess_disabled"),
			});
		const first = makeSession();
		await first.afterRun(editRun().result);
		await first.settled();
		expect(first.currentPush().state).toBe("ready");

		const respawned = makeSession();
		expect(respawned.currentPush().state).toBe("ready");
		const host = fakeSlotHost();
		const plugin = createNextTurnPlugin({
			startRuntime: () => fakeRuntime(respawned),
			lifecycle: { active: () => false },
		});
		await plugin.setup?.(host.api as never, {
			session: { sessionId: "sess_disabled" },
			client: { name: "cline-desktop" },
			ui: host.ui,
		});
		expect(host.invoke({ verb: "attach", surface: "desktop" })).toEqual({
			outcome: "ok",
		});
		const reply = respawned.currentPush();
		expect(reply).toMatchObject({ state: "off", offReason: "disabled" });
		expect(reply.set).toBeUndefined();
		expect(reply.seq).toBeGreaterThan(first.currentPush().seq);
		expect(host.latest()).toMatchObject({
			status: "hidden",
			hiddenReason: "disabled",
			items: [],
		});
	});

	test("a settings file that stops parsing keeps the plugin as it was, and a removed one enables it", () => {
		const dir = tempDir();
		const entryPath = join(dir, "dist", "index.js");
		writeFileSync(join(dir, "package.json"), "{}");
		const settingsPath = join(dir, "global-settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify({ disabledPlugins: [entryPath] }),
		);
		const lifecycle = new PluginLifecycle({
			settingsPath,
			packageRoot: dir,
			entryPaths: [entryPath],
		});
		expect(lifecycle.active()).toBe(false);
		writeFileSync(settingsPath, "{ not json");
		expect(lifecycle.active()).toBe(false);
		rmSync(settingsPath);
		expect(lifecycle.active()).toBe(true);
	});
});

describe("Next Turn on a host that renders the composer.suggestions slot", () => {
	test("a disabled plugin answers every verb by showing the tray as disabled and refuses Use and Send as stale, whether or not Next started", async () => {
		let enabled = true;
		const lifecycle = { active: () => enabled };
		const host = fakeSlotHost();
		const runtime = fakeRuntime();
		const plugin = createNextTurnPlugin({
			startRuntime: () => runtime,
			lifecycle,
		});
		await plugin.setup?.(host.api as never, slotContext(host));
		enabled = false;
		const row = { revision: "r1", itemId: "a1", input: "key" } as const;
		for (const verb of ["use", "send"] as const)
			expect([verb, host.invoke({ verb, ...row })]).toEqual([
				verb,
				{ outcome: "refused", reason: "stale" },
			]);
		expect(host.invoke({ verb: "skip", ...row })).toEqual({ outcome: "ok" });
		expect(host.latest()).toMatchObject({
			status: "hidden",
			hiddenReason: "disabled",
			revision: "none",
		});
		const unbound = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: sessionEnv(cliSetupContext, { tools: () => [] }),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
		});
		const onScreen = await unbound.afterRun(editRun().result);
		runtime.next = unbound;
		host.states.splice(0);
		expect(
			host.invoke({
				verb: "send",
				revision: onScreen?.offerId ?? "",
				itemId: onScreen?.candidates[0]?.id ?? "",
				input: "key",
			}),
		).toEqual({ outcome: "refused", reason: "stale" });
		expect(unbound.currentPush()).toMatchObject({
			state: "off",
			offReason: "disabled",
		});
		expect(host.states).toEqual([
			expect.objectContaining({ status: "hidden", hiddenReason: "disabled" }),
		]);
		expect(host.invoke({ verb: "attach", surface: "desktop" })).toEqual({
			outcome: "ok",
		});
		expect(host.latest()?.hiddenReason).toBe("disabled");
	});

	test("re-enabling the plugin restarts the connector refresher only for a viewed chat", async () => {
		for (const viewed of [false, true]) {
			let enabled = true;
			const refresher = { starts: 0, stops: 0 };
			const connectors = {
				refresher: {
					start: async () => {
						refresher.starts += 1;
					},
					stop: () => {
						refresher.stops += 1;
					},
				},
			} as unknown as SessionRuntime["connectors"];
			const host = fakeSlotHost();
			const { start } = presence({}, { connectors });
			const plugin = createNextTurnPlugin({
				startRuntime: start,
				lifecycle: { active: () => enabled },
			});
			await plugin.setup?.(host.api as never, slotContext(host));
			if (viewed) host.invoke({ verb: "attach", surface: "desktop" });
			const exposed = { verb: "exposed", revision: "r1", itemIds: [] } as const;
			enabled = false;
			host.invoke({ ...exposed, itemIds: [] });
			enabled = true;
			host.invoke({ ...exposed, itemIds: [] });
			expect([viewed, refresher]).toEqual([
				viewed,
				{ starts: viewed ? 1 : 0, stops: 1 },
			]);
		}
	});

	test("a viewer that attaches while the plugin is disabled starts nothing, and is served once the plugin is enabled again", async () => {
		const settings = defaultSettings();
		settings.notify.needsYou = false;
		settings.planner.callsPerHour = 0;
		let enabled = false;
		let started: SessionRuntime | undefined;
		const host = fakeSlotHost();
		const plugin = createNextTurnPlugin({
			startRuntime: (startContext, { active }) => {
				started = startSessionRuntime(startContext, {
					settings: () => settings,
					active,
					pluginActive: () => enabled,
					hubLink: offlineHub,
					runCommand: noCommands,
				});
				return started;
			},
			lifecycle: { active: () => enabled },
		});
		await plugin.setup?.(
			host.api as never,
			slotContext(host, {
				session: { sessionId: "sess_attached_while_disabled" },
				workspaceInfo: { rootPath: tempDir() },
			}),
		);
		try {
			expect(host.invoke({ verb: "attach", surface: "desktop" })).toEqual({
				outcome: "ok",
			});
			expect(host.latest()?.hiddenReason).toBe("disabled");
			expect([started?.viewed(), started?.next]).toEqual([true, undefined]);
			enabled = true;
			await agentFor(plugin).run("Add a retry to the client");
			await started?.next?.settled();
			expect(host.latest()?.status).toBe("ready");
		} finally {
			await started?.stop();
		}
	});
});
