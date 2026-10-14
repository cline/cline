import { describe, expect, test } from "bun:test";
import {
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
import { LabelLog } from "./planner/labels";
import { NextSession } from "./planner/next";
import { createNextTurnPlugin } from "./plugin";
import { type SetupContext, sessionEnv } from "./runtime";
import { defaultSettings } from "./settings/settings";
import { FileSessionStateStore } from "./store/session-state";
import { editorTool, editRun, fakeRuntime, useTempDirs } from "./test-support";

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
		const pushes: Array<{ state: string }> = [];
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
		let handler: ((input: unknown) => Promise<unknown> | unknown) | undefined;
		const plugin = createNextTurnPlugin({
			startRuntime: () => fakeRuntime(next),
			lifecycle,
		});
		await plugin.setup?.(
			{
				registerUiHandler(
					name: string,
					fn: (input: unknown) => Promise<unknown> | unknown,
				) {
					if (name === "next") handler = fn;
				},
			} as never,
			{
				...context,
				ui: {
					push(_event: string, payload: unknown) {
						pushes.push(payload as { state: string });
					},
				},
			} as never,
		);

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
		expect(pushes.map((p) => p.state)).toEqual(["off"]);
		expect(await handler?.({ type: "current" })).toMatchObject({
			state: "off",
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
		expect(planners).toEqual([undefined, "rules"]);
		expect(readFileSync(labelsPath, "utf8").trim().split("\n")).toHaveLength(1);

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

	test("a chat set up while the plugin is disabled answers current with off, not the saved set", async () => {
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
		let handler: ((input: unknown) => Promise<unknown> | unknown) | undefined;
		const plugin = createNextTurnPlugin({
			startRuntime: () => fakeRuntime(respawned),
			lifecycle: { active: () => false },
		});
		await plugin.setup?.(
			{
				registerUiHandler(
					name: string,
					fn: (input: unknown) => Promise<unknown> | unknown,
				) {
					if (name === "next") handler = fn;
				},
			} as never,
			{
				session: { sessionId: "sess_disabled" },
				client: { name: "cline-desktop" },
			} as never,
		);
		const reply = (await handler?.({ type: "current" })) as {
			state: string;
			seq: number;
			set?: unknown;
		};
		expect(reply.state).toBe("off");
		expect(reply.set).toBeUndefined();
		expect(reply.seq).toBeGreaterThan(first.currentPush().seq);
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
