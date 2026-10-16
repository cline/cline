import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	Agent,
	countUserRunMessages as coreCount,
	loadAgentPluginFromPath,
} from "@cline/core";
import type { ContextSource } from "./context/source";
import { EMPTY_BACKLOG } from "./planner/backlog";
import { LabelLog } from "./planner/labels/labels";
import { NextSession } from "./planner/session/session";
import type { OfferedSet } from "./planner/tray/tray";
import { deriveTurn } from "./planner/turn/turn";
import { createNextTurnPlugin, defaultIsNextActive } from "./plugin";
import {
	type SessionRuntime,
	type SetupContext,
	sessionEnv,
	startSessionRuntime,
} from "./runtime";
import { defaultSettings } from "./settings/settings";
import { editingModel, editorTool } from "./test-support/agent-runs";
import {
	alwaysActive,
	cliSetupContext as context,
	fakeRuntime,
} from "./test-support/plugin-host";
import { useTempDirs } from "./test-support/temp-dirs";

const tempDir = useTempDirs("next-turn-plugin-");

describe("Next Turn as a plugin", () => {
	test("the default export loads through the real SDK loader with its hooks and setup", async () => {
		const plugin = await loadAgentPluginFromPath(`${import.meta.dir}/index.ts`);
		expect(plugin.name).toBe("next-turn");
		expect(plugin.manifest.capabilities).toEqual(["hooks"]);
		expect(Object.keys(plugin.hooks ?? {}).sort()).toEqual([
			"afterRun",
			"beforeModel",
		]);
		expect(typeof plugin.setup).toBe("function");
	});

	test("a real agent run serves a set, and the next message is labelled against it", async () => {
		const labelsPath = join(tempDir(), "labels.jsonl");
		const sets: (OfferedSet | undefined)[] = [];
		let tools: readonly string[] = [];
		const sources: ContextSource[] = [
			{ id: "turn", tier: "T0", probe: () => "present" },
			{ id: "tasks", tier: "T2", probe: () => "present" },
		];
		const next = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: sessionEnv(context, { tools: () => tools }),
			sources: () => sources,
			backlog: async () => EMPTY_BACKLOG,
			labels: new LabelLog(labelsPath),
		});
		next.onSet((set) => sets.push(set));
		const runtime = fakeRuntime(next, {
			setTools: (names) => {
				tools = names;
			},
		});
		const plugin = createNextTurnPlugin({
			startRuntime: () => runtime,
			lifecycle: alwaysActive,
		});
		await plugin.setup?.(
			{} as Parameters<NonNullable<typeof plugin.setup>>[0],
			context,
		);
		const agent = new Agent({
			model: editingModel().model,
			tools: [editorTool],
			hooks: plugin.hooks,
		});
		await agent.run("Add a retry to the client");
		await next.settled();
		expect(tools).toEqual(["editor"]);
		const served = sets[0];
		expect(served?.cueCode).toBe("completed_edits");
		expect(served?.candidates.map((row) => row.kind)).toEqual([
			"next_step",
			"verify",
			"review_diff",
		]);
		await agent.run(served?.candidates[1]?.prompt ?? "");
		await next.settled();
		const events = readFileSync(labelsPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => (JSON.parse(line) as { event: string }).event);
		expect(events.slice(0, 3)).toEqual(["offer", "do", "superseded"]);
	});

	test("a non-root run counts its own transcript, so the plugin serves only the root's", async () => {
		const sets: (OfferedSet | undefined)[] = [];
		const next = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: sessionEnv(context, { tools: () => [] }),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
			labels: new LabelLog(join(tempDir(), "labels.jsonl")),
		});
		next.onSet((set) => sets.push(set));
		const plugin = createNextTurnPlugin({
			startRuntime: () => fakeRuntime(next),
			lifecycle: alwaysActive,
		});
		await plugin.setup?.(
			{} as Parameters<NonNullable<typeof plugin.setup>>[0],
			context,
		);
		const root = new Agent({
			model: editingModel().model,
			tools: [editorTool],
			hooks: plugin.hooks,
		});
		await root.run("Add a retry to the client");
		await next.settled();
		expect(sets.map((set) => set?.turnKey)).toEqual(["sess_1:1"]);
		const sub = new Agent({
			model: editingModel().model,
			tools: [editorTool],
			hooks: plugin.hooks,
			parentAgentId: "agent_root",
		});
		const delegated = await sub.run("Investigate the parser");
		await next.settled();
		expect(coreCount(delegated.messages)).toBe(1);
		expect(deriveTurn("sess_1", delegated)).toMatchObject({
			runCount: 1,
			turnKey: "sess_1:1",
		});
		expect(sets.map((set) => set?.turnKey)).toEqual(["sess_1:1"]);
	});

	test("a starter that throws cannot fail setup, and no runtime starts without a session or a feature", async () => {
		const throwing = createNextTurnPlugin({
			startRuntime: () => {
				throw new Error("boom");
			},
			lifecycle: alwaysActive,
		});
		expect(() =>
			throwing.setup?.(
				{} as Parameters<NonNullable<typeof throwing.setup>>[0],
				context,
			),
		).not.toThrow();
		const off = defaultSettings();
		off.features.next = false;
		off.notify.needsYou = false;
		expect(
			startSessionRuntime({}, { settings: defaultSettings, active: true }),
		).toBeUndefined();
		expect(
			startSessionRuntime(context, { settings: () => off, active: true }),
		).toBeUndefined();
	});

	test("turning Next on in an open chat serves its next run, whether setup started nothing or only notifications", async () => {
		for (const needsYou of [false, true]) {
			const settings = defaultSettings();
			settings.features.next = false;
			settings.notify.needsYou = needsYou;
			const next = new NextSession({
				sessionId: "sess_1",
				settings: () => settings,
				env: sessionEnv(context, { tools: () => [] }),
				sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
				backlog: async () => EMPTY_BACKLOG,
			});
			const sets: (OfferedSet | undefined)[] = [];
			next.onSet((set) => sets.push(set));
			const plugin = createNextTurnPlugin({
				startRuntime: (_context, { active }) => {
					if (!settings.features.next && !settings.notify.needsYou)
						return undefined;
					const runtime = fakeRuntime(undefined, {
						setViewed: () => {
							if (settings.features.next) runtime.next = next;
							return runtime.next;
						},
					});
					if (active) runtime.setViewed(true);
					return runtime;
				},
				lifecycle: alwaysActive,
			});
			await plugin.setup?.(
				{} as Parameters<NonNullable<typeof plugin.setup>>[0],
				context,
			);
			const agent = new Agent({
				model: editingModel().model,
				tools: [editorTool],
				hooks: plugin.hooks,
			});
			await agent.run("A turn while Next is off");
			settings.features.next = true;
			await agent.run("A turn after Next was turned on");
			await next.settled();
			expect([needsYou, sets.filter(Boolean).length]).toEqual([needsYou, 1]);
		}
	});

	test("the session's environment comes from the setup context", () => {
		expect(sessionEnv(context, { tools: () => ["editor"] })()).toEqual({
			client: "cline-cli",
			sessionId: "sess_1",
			workspaceRoot: "/w",
			git: {
				branch: "main",
				commit: undefined,
				remotes: ["git@github.com:o/r.git"],
			},
			tools: ["editor"],
		});
		expect(sessionEnv({}, { tools: () => [] })().git).toBeUndefined();
		expect(
			sessionEnv(context, {
				tools: () => [],
				git: () => ({ branch: "feature", commit: "abc" }),
				chatProviderId: () => "anthropic",
			})(),
		).toMatchObject({
			client: "cline-cli",
			providerId: "anthropic",
			git: { branch: "feature", commit: "abc" },
		});
	});

	test("the default gate starts Next at once unless the host renders the composer.suggestions slot", () => {
		const registerUiSlot = () => undefined;
		const ui = (slots: string[]) => ({ slots, update: () => undefined });
		expect(defaultIsNextActive({}, {})).toBe(true);
		expect(defaultIsNextActive({ registerUiSlot }, {})).toBe(true);
		expect(defaultIsNextActive({}, { ui: ui(["composer.suggestions"]) })).toBe(
			true,
		);
		expect(
			defaultIsNextActive({ registerUiSlot }, { ui: ui(["composer.other"]) }),
		).toBe(true);
		expect(
			defaultIsNextActive(
				{ registerUiSlot },
				{ ui: ui(["composer.suggestions"]) },
			),
		).toBe(false);
	});

	test("the afterRun hook waits for the rule-based set but not the planner or the connector refresh, so a one-shot run closed at once keeps its offer", async () => {
		const labelsPath = join(tempDir(), "labels.jsonl");
		const sets: (OfferedSet | undefined)[] = [];
		const logged: string[] = [];
		const disposers: Array<() => unknown> = [];
		const oneShot: SetupContext = {
			...context,
			logger: {
				debug: (message) => {
					logged.push(message);
				},
				log: () => {},
			},
			onDispose: (cleanup) => {
				disposers.push(cleanup);
			},
		};
		let answerPlanner: (answer: null) => void = () => {};
		const next = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: sessionEnv(oneShot, { tools: () => [] }),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
			dirtyFiles: () =>
				new Promise((resolve) => setTimeout(() => resolve(1), 30)),
			complete: () =>
				new Promise((resolve) => {
					answerPlanner = resolve;
				}),
			labels: new LabelLog(labelsPath),
		});
		next.onSet((set) => sets.push(set));
		let refreshed: (setsServed: number) => void = () => {};
		const setsServedAtRefresh = new Promise<number>((resolve) => {
			refreshed = resolve;
		});
		let finishRefresh: () => void = () => {};
		const connectors = {
			onTurn: () => {
				refreshed(sets.length);
				return new Promise<void>((resolve) => {
					finishRefresh = resolve;
				});
			},
		} as unknown as SessionRuntime["connectors"];
		const plugin = createNextTurnPlugin({
			startRuntime: () =>
				fakeRuntime(next, { connectors, stop: () => next.dispose() }),
			lifecycle: alwaysActive,
		});
		await plugin.setup?.(
			{} as Parameters<NonNullable<typeof plugin.setup>>[0],
			oneShot,
		);
		const agent = new Agent({
			model: editingModel().model,
			tools: [editorTool],
			hooks: plugin.hooks,
		});
		await agent.run("Add a retry to the client");
		await Promise.all(disposers.map((dispose) => dispose()));

		expect(sets.map((set) => [set?.planner, set?.model?.status])).toEqual([
			["rules", "pending"],
		]);
		expect(logged).toContain("[next-turn] suggestions");
		const offers = readFileSync(labelsPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { event: string; planner: string })
			.filter((record) => record.event === "offer");
		expect(offers.map((record) => record.planner)).toEqual(["rules"]);
		expect(await setsServedAtRefresh).toBe(1);
		finishRefresh();
		answerPlanner(null);
		await next.settled();
	});

	test("setup registers teardown that stops the runtime, and a second setup stops the first runtime", async () => {
		const stopped: string[] = [];
		const disposers: Array<() => unknown> = [];
		const runtimeNamed = (name: string) =>
			fakeRuntime(undefined, {
				stop: () => {
					stopped.push(name);
				},
			});
		const runtimes = [runtimeNamed("first"), runtimeNamed("second")];
		const plugin = createNextTurnPlugin({
			startRuntime: () => runtimes.shift(),
			lifecycle: alwaysActive,
		});
		const disposing = {
			...context,
			onDispose: (cleanup: () => unknown) => disposers.push(cleanup),
		};
		await plugin.setup?.(
			{} as Parameters<NonNullable<typeof plugin.setup>>[0],
			disposing,
		);
		await plugin.setup?.(
			{} as Parameters<NonNullable<typeof plugin.setup>>[0],
			disposing,
		);
		await Promise.resolve();
		expect(stopped).toEqual(["first"]);
		await Promise.all(disposers.map((dispose) => dispose()));
		expect(stopped).toEqual(["first", "first", "second"]);
	});

	test("a runtime whose stop throws is logged, and the next setup still starts", async () => {
		const logged: string[] = [];
		const runtimes = [
			fakeRuntime(undefined, {
				stop: () => {
					throw new Error("boom");
				},
			}),
			fakeRuntime(),
		];
		let started = 0;
		const plugin = createNextTurnPlugin({
			startRuntime: () => {
				started += 1;
				return runtimes.shift();
			},
			lifecycle: alwaysActive,
		});
		const logging: SetupContext = {
			...context,
			logger: {
				debug: (message) => {
					logged.push(message);
				},
				log: () => {},
			},
		};
		const api = {} as Parameters<NonNullable<typeof plugin.setup>>[0];
		await plugin.setup?.(api, logging);
		await plugin.setup?.(api, logging);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(started).toBe(2);
		expect(logged).toContain("[next-turn] the runtime did not stop");
	});
});
