import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	Agent,
	type AgentPlugin,
	countUserRunMessages as coreCount,
	loadAgentPluginFromPath,
} from "@cline/core";
import type { ComposerSuggestionsAction, PluginUiSurface } from "@cline/shared";
import type { ContextSource } from "./context/source";
import { EMPTY_BACKLOG } from "./planner/backlog";
import { LabelLog } from "./planner/labels";
import { type NextOptions, NextSession } from "./planner/next";
import type { OfferedSet } from "./planner/tray";
import { deriveTurn } from "./planner/turn";
import { createNextTurnPlugin, defaultIsNextActive } from "./plugin";
import {
	type SessionRuntime,
	type SetupContext,
	sessionEnv,
	startSessionRuntime,
} from "./runtime";
import { defaultSettings } from "./settings/settings";
import {
	alwaysActive,
	editingModel,
	editorTool,
	editRun,
	fakeRuntime,
	fakeSlotHost,
	flushDetached,
	noCommands,
	offlineHub,
	useTempDirs,
} from "./test-support";

const tempDir = useTempDirs("next-turn-plugin-");

const context: SetupContext = {
	session: { sessionId: "sess_1" },
	client: { name: "cline-cli" },
	workspaceInfo: {
		rootPath: "/w",
		latestGitBranchName: "main",
		associatedRemoteUrls: ["git@github.com:o/r.git"],
	},
};

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

const MODEL_ANSWER =
	'{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run bun test on retry.ts.","why":"retry.ts changed"}]}';

/**
 * Next around a runtime that keeps it dormant until viewed, as
 * `startSessionRuntime` does: `viewing` records each `setViewed`, each start
 * of Next and each turn recorded while dormant.
 */
function presence(
	nextOptions: Partial<NextOptions> = {},
	runtimeOverrides: Partial<SessionRuntime> = {},
	nextOn: () => boolean = () => true,
) {
	const viewing = {
		viewed: false,
		activated: 0,
		dormant: 0,
		calls: [] as [boolean, PluginUiSurface | undefined][],
	};
	const next = new NextSession({
		sessionId: "sess_1",
		settings: defaultSettings,
		env: sessionEnv(context, { tools: () => [] }),
		sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
		backlog: async () => EMPTY_BACKLOG,
		viewed: () => viewing.viewed,
		...nextOptions,
	});
	const runtime: SessionRuntime = fakeRuntime(undefined, {
		setViewed: (viewed, surface) => {
			viewing.viewed = viewed;
			viewing.calls.push([viewed, surface]);
			if (viewed && !runtime.next && nextOn()) {
				viewing.activated += 1;
				runtime.next = next;
			}
			return runtime.next;
		},
		viewed: () => viewing.viewed,
		recordDormantTurn: () => {
			viewing.dormant += 1;
		},
		...runtimeOverrides,
	});
	const start = (_context: SetupContext, { active }: { active: boolean }) => {
		if (active) runtime.setViewed(true);
		return runtime;
	};
	return { next, runtime, viewing, start };
}

function agentFor(plugin: AgentPlugin): Agent {
	return new Agent({
		model: editingModel().model,
		tools: [editorTool],
		hooks: plugin.hooks,
	});
}

function slotContext(
	host: ReturnType<typeof fakeSlotHost>,
	extra: Partial<SetupContext> = {},
): SetupContext {
	return {
		...context,
		client: { name: "cline-desktop" },
		ui: host.ui,
		...extra,
	};
}

/** A connector's Check CI row: GitHub connected, a GitHub remote, a failing check. */
const githubSources: ContextSource[] = [
	{ id: "turn", tier: "T0", probe: () => "present" },
	{
		id: "git",
		tier: "T1",
		probe: () => "present",
		capabilities: () => ["remote:github"],
	},
	{
		id: "github",
		tier: "T3",
		probe: () => "present",
		capabilities: () => ["github", "github:gh"],
	},
];

describe("Next Turn on a host that renders the composer.suggestions slot", () => {
	test("the gate follows the slot API, not the client: with it Next waits for a viewer, without it Next starts at once, runs the planner and logs each set", async () => {
		let planned = 0;
		const complete = async () => {
			planned += 1;
			return { text: MODEL_ANSWER };
		};
		const slotHost = fakeSlotHost();
		const dormant = presence({ complete });
		const waiting = createNextTurnPlugin({
			startRuntime: dormant.start,
			lifecycle: alwaysActive,
		});
		await waiting.setup?.(slotHost.api as never, slotContext(slotHost));
		expect(slotHost.registered()?.slot).toBe("composer.suggestions");
		await agentFor(waiting).run("Add a retry to the client");
		await dormant.next.settled();
		expect([
			dormant.viewing.activated,
			dormant.viewing.dormant,
			planned,
		]).toEqual([0, 1, 0]);

		const inProcess = fakeSlotHost();
		const otherCatalog = fakeSlotHost(["composer.other"]);
		for (const [label, api, ui] of [
			["no slot API", {}, undefined],
			["registerUiSlot without ctx.ui", inProcess.api, undefined],
			["a catalog without the slot", otherCatalog.api, otherCatalog.ui],
		] as const) {
			planned = 0;
			const logged: string[] = [];
			const started = presence({ complete });
			const plugin = createNextTurnPlugin({
				startRuntime: started.start,
				lifecycle: alwaysActive,
			});
			await plugin.setup?.(api as never, {
				...context,
				...(ui ? { ui } : {}),
				logger: {
					debug: (message) => {
						logged.push(message);
					},
					log: () => {},
				},
			});
			expect([label, started.viewing.activated]).toEqual([label, 1]);
			await agentFor(plugin).run("Add a retry to the client");
			await started.next.settled();
			expect([label, planned, started.next.current()?.planner]).toEqual([
				label,
				1,
				"model",
			]);
			expect(logged).toContain("[next-turn] suggestions");
		}
		expect(inProcess.registered()).toBeUndefined();
		expect(otherCatalog.registered()).toBeUndefined();
	});

	test("an attach serves the set, the set streams to the slot, and Skip and Unskip serve new sets; an unknown verb is refused", async () => {
		const host = fakeSlotHost();
		const { next, viewing, start } = presence({
			sources: () => [
				{ id: "turn", tier: "T0", probe: () => "present" },
				{ id: "tasks", tier: "T2", probe: () => "present" },
			],
			complete: async () => ({ text: MODEL_ANSWER }),
		});
		const plugin = createNextTurnPlugin({
			startRuntime: start,
			lifecycle: alwaysActive,
		});
		await plugin.setup?.(host.api as never, slotContext(host));
		expect(host.invoke({ verb: "attach", surface: "desktop" })).toEqual({
			outcome: "ok",
		});
		expect(viewing.calls).toEqual([[true, "desktop"]]);
		await flushDetached();
		expect(host.latest()).toMatchObject({
			status: "hidden",
			hiddenReason: "superseded",
			title: "Next",
			revision: "none",
		});
		await agentFor(plugin).run("Add a retry to the client");
		await next.settled();
		expect(host.states.map((state) => state?.status)).toEqual([
			"hidden",
			"loading",
			"ready",
			"ready",
		]);
		const shown = host.latest();
		expect(shown?.revision).toBe(next.current()?.offerId);
		expect(shown?.cue).toEqual({ text: "after 1 file changed", tone: "check" });

		host.states.splice(0);
		expect(
			host.invoke({ verb: "attach", surface: "desktop" }, "other"),
		).toEqual({ outcome: "ok" });
		await flushDetached();
		expect(host.states).toEqual([shown ?? null]);

		const firstId = shown?.items[0]?.id ?? "";
		expect(
			host.invoke({
				verb: "skip",
				revision: shown?.revision ?? "",
				itemId: firstId,
				input: "key",
			}),
		).toEqual({ outcome: "ok" });
		const afterSkip = host.latest();
		expect(afterSkip?.revision).not.toBe(shown?.revision);
		expect(afterSkip?.items.map((item) => item.id)).not.toContain(firstId);
		expect(
			host.invoke({
				verb: "unskip",
				revision: afterSkip?.revision ?? "",
				itemId: firstId,
				input: "pointer",
			}),
		).toEqual({ outcome: "ok" });
		expect(host.latest()?.items.map((item) => item.id)).toContain(firstId);
		expect(
			host.invoke({
				verb: "skip",
				revision: shown?.revision ?? "",
				itemId: "gone",
				input: "key",
			}),
		).toEqual({ outcome: "refused", reason: "stale" });
		expect(
			host.invoke({ verb: "dance" } as unknown as ComposerSuggestionsAction),
		).toEqual({ outcome: "refused" });
	});

	test("an attach answers before its serve settles, so a verb behind it is not held", async () => {
		const host = fakeSlotHost();
		const { start } = presence({ readTranscript: () => new Promise(() => {}) });
		const plugin = createNextTurnPlugin({
			startRuntime: start,
			lifecycle: alwaysActive,
		});
		await plugin.setup?.(host.api as never, slotContext(host));
		expect(host.invoke({ verb: "attach", surface: "desktop" })).toEqual({
			outcome: "ok",
		});
		expect(
			host.invoke({ verb: "skip", revision: "r1", itemId: "a1", input: "key" }),
		).toEqual({ outcome: "refused", reason: "stale" });
	});

	test("an attach with no runtime, or with Next off in settings, shows the tray as disabled", async () => {
		const withoutRuntime = fakeSlotHost();
		const idle = createNextTurnPlugin({
			startRuntime: () => undefined,
			lifecycle: alwaysActive,
		});
		await idle.setup?.(
			withoutRuntime.api as never,
			slotContext(withoutRuntime),
		);
		const nextOff = fakeSlotHost();
		const { start } = presence({}, {}, () => false);
		const off = createNextTurnPlugin({
			startRuntime: start,
			lifecycle: alwaysActive,
		});
		await off.setup?.(nextOff.api as never, slotContext(nextOff));
		for (const host of [withoutRuntime, nextOff]) {
			expect(host.invoke({ verb: "attach", surface: "desktop" })).toEqual({
				outcome: "ok",
			});
			expect(host.latest()).toEqual({
				status: "hidden",
				hiddenReason: "disabled",
				title: "Next",
				command: "next",
				revision: "none",
				items: [],
				canRefresh: false,
			});
		}
	});

	test("Next turned on after an attach found it off starts at the next turn, and so it does on a host with no slot", async () => {
		for (const slot of [true, false]) {
			let nextOn = false;
			const host = fakeSlotHost();
			const { next, viewing, start } = presence({}, {}, () => nextOn);
			const plugin = createNextTurnPlugin({
				startRuntime: start,
				lifecycle: alwaysActive,
			});
			await plugin.setup?.(
				(slot ? host.api : {}) as never,
				slot ? slotContext(host) : context,
			);
			if (slot) host.invoke({ verb: "attach", surface: "desktop" });
			const agent = agentFor(plugin);
			await agent.run("A turn while Next is off");
			nextOn = true;
			await agent.run("A turn after Next was turned on");
			await next.settled();
			expect([slot, viewing.activated, next.current()?.runCount]).toEqual([
				slot,
				1,
				2,
			]);
			if (slot) expect(host.latest()?.status).toBe("ready");
		}
	});

	test("a runtime first started by a turn after an attach starts viewed", async () => {
		let featureOn = false;
		const host = fakeSlotHost();
		const { next, viewing, start } = presence();
		const plugin = createNextTurnPlugin({
			startRuntime: (startContext, options) =>
				featureOn ? start(startContext, options) : undefined,
			lifecycle: alwaysActive,
		});
		await plugin.setup?.(host.api as never, slotContext(host));
		host.invoke({ verb: "attach", surface: "desktop" });
		expect(host.latest()?.hiddenReason).toBe("disabled");
		featureOn = true;
		await agentFor(plugin).run("Add a retry to the client");
		await next.settled();
		expect(viewing.calls).toEqual([[true, "desktop"]]);
		expect(host.latest()?.status).toBe("ready");
	});

	test("once the last viewer detaches a turn is only recorded, and the next attach serves that turn", async () => {
		let planned = 0;
		let refreshed = 0;
		const connectors = {
			onTurn: async () => {
				refreshed += 1;
			},
		} as unknown as SessionRuntime["connectors"];
		const host = fakeSlotHost();
		const { next, viewing, start } = presence(
			{
				complete: async () => {
					planned += 1;
					return { text: MODEL_ANSWER };
				},
			},
			{ connectors },
		);
		const plugin = createNextTurnPlugin({
			startRuntime: start,
			lifecycle: alwaysActive,
		});
		await plugin.setup?.(host.api as never, slotContext(host));
		host.invoke({ verb: "attach", surface: "desktop" }, "first");
		host.invoke({ verb: "attach", surface: "desktop" }, "second");
		const agent = agentFor(plugin);
		await agent.run("Add a retry to the client");
		await next.settled();
		const earlier = next.current();
		expect([planned, refreshed, earlier?.runCount]).toEqual([1, 1, 1]);

		host.invoke({ verb: "detach" }, "first");
		expect(viewing.calls.map(([viewed]) => viewed)).toEqual([true, true]);
		host.invoke({ verb: "detach" }, "second");
		expect(viewing.calls.at(-1)).toEqual([false, undefined]);
		await agent.run("Now the parser");
		await next.settled();
		expect([planned, refreshed]).toEqual([1, 1]);
		expect(next.current()).toBeUndefined();
		expect(next.turn()?.runCount).toBe(2);

		host.invoke({ verb: "attach", surface: "desktop" }, "first");
		await flushDetached();
		await next.settled();
		const served = next.current();
		expect(served?.runCount).toBe(2);
		expect(served?.offerId).not.toBe(earlier?.offerId);
		expect(host.latest()?.revision).toBe(served?.offerId);
	});

	test("Send on a connector's row is refused as Use only", async () => {
		const host = fakeSlotHost();
		const { next, start } = presence({
			sources: () => githubSources,
			github: () => ({ failingChecks: ["build"] }),
		});
		const plugin = createNextTurnPlugin({
			startRuntime: start,
			lifecycle: alwaysActive,
		});
		await plugin.setup?.(host.api as never, slotContext(host));
		host.invoke({ verb: "attach", surface: "desktop" });
		await agentFor(plugin).run("Add a retry to the client");
		await next.settled();
		const row = host.latest()?.items.find((item) => item.label === "Check CI");
		expect(row?.sendable).toBe(false);
		expect(
			host.invoke({
				verb: "send",
				revision: host.latest()?.revision ?? "",
				itemId: row?.id ?? "",
				input: "key",
			}),
		).toEqual({ outcome: "refused", reason: "unsendable" });
	});

	test("Show after hiding the chat clears the hide, answers at once and serves a set", async () => {
		const host = fakeSlotHost();
		const { next, start } = presence();
		const plugin = createNextTurnPlugin({
			startRuntime: start,
			lifecycle: alwaysActive,
		});
		await plugin.setup?.(host.api as never, slotContext(host));
		host.invoke({ verb: "attach", surface: "desktop" });
		await agentFor(plugin).run("Add a retry to the client");
		await next.settled();
		expect(
			host.invoke({ verb: "hide", scope: "chat", input: "command" }),
		).toEqual({ outcome: "ok" });
		expect(host.latest()).toMatchObject({
			status: "hidden",
			hiddenReason: "user",
		});
		host.states.splice(0);
		expect(host.invoke({ verb: "show", input: "command" })).toEqual({
			outcome: "ok",
		});
		await flushDetached();
		await next.settled();
		expect(
			host.states.map((state) => [state?.status, state?.hiddenReason]),
		).toEqual([
			["hidden", "superseded"],
			["loading", undefined],
			["ready", undefined],
			["ready", undefined],
		]);
		expect(next.current()?.trigger).toBe("on_demand");
	});

	test("a disabled plugin answers every verb by showing the tray as disabled, whether or not Next started", async () => {
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
		expect(
			host.invoke({ verb: "use", revision: "r1", itemId: "a1", input: "key" }),
		).toEqual({ outcome: "ok" });
		expect(host.latest()).toMatchObject({
			status: "hidden",
			hiddenReason: "disabled",
			revision: "none",
		});
		const unbound = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: sessionEnv(context, { tools: () => [] }),
			sources: () => [],
			backlog: async () => EMPTY_BACKLOG,
		});
		runtime.next = unbound;
		host.states.splice(0);
		expect(host.invoke({ verb: "attach", surface: "desktop" })).toEqual({
			outcome: "ok",
		});
		expect(unbound.currentPush()).toMatchObject({
			state: "off",
			offReason: "disabled",
		});
		expect(host.states).toEqual([
			expect.objectContaining({ status: "hidden", hiddenReason: "disabled" }),
		]);
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

	test("an attach on a chat with no turn in memory serves a set from the hub's transcript", async () => {
		const { messages } = editRun("Forked chat turn");
		let transcriptReads = 0;
		const host = fakeSlotHost();
		const { next, start } = presence({
			readTranscript: async () => {
				transcriptReads += 1;
				return { messages, status: "completed" };
			},
		});
		const plugin = createNextTurnPlugin({
			startRuntime: start,
			lifecycle: alwaysActive,
		});
		await plugin.setup?.(host.api as never, slotContext(host));
		host.invoke({ verb: "attach", surface: "desktop" });
		await flushDetached();
		await next.settled();
		expect(host.latest()?.status).toBe("ready");
		expect(next.current()?.trigger).toBe("on_demand");
		expect(next.current()?.runId).toBeUndefined();
		expect(transcriptReads).toBe(1);
	});
});
