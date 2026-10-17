import { describe, expect, test } from "bun:test";
import type { ComposerSuggestionsAction } from "@cline/shared";
import type { ContextSource } from "./context/source";
import { createNextTurnPlugin } from "./plugin";
import { type SessionRuntime, startSessionRuntime } from "./runtime";
import { defaultSettings } from "./settings/settings";
import { editRun } from "./test-support/agent-runs";
import {
	agentFor,
	alwaysActive,
	cliSetupContext as context,
	fakeRuntime,
	fakeSlotHost,
	flushDetached,
	noCommands,
	offlineHub,
	presence,
	slotContext,
} from "./test-support/plugin-host";
import { useTempDirs } from "./test-support/temp-dirs";

const tempDir = useTempDirs("next-turn-plugin-");

const MODEL_ANSWER =
	'{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run bun test on retry.ts.","why":"retry.ts changed"}]}';

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
		expect(
			host.states.map((state) => [state?.status, state?.hiddenReason]),
		).toEqual([
			["hidden", undefined],
			["hidden", "superseded"],
			["loading", undefined],
			["ready", undefined],
		]);
		expect(next.current()?.planner).toBe("model");
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

	test("a chat nobody views yet publishes a plain hidden state at setup, and one that starts viewed publishes nothing", async () => {
		const dormant = fakeSlotHost();
		const waiting = createNextTurnPlugin({
			startRuntime: presence().start,
			lifecycle: alwaysActive,
		});
		await waiting.setup?.(dormant.api as never, slotContext(dormant));
		expect(dormant.states).toEqual([
			expect.objectContaining({
				status: "hidden",
				title: "Next",
				command: "next",
				revision: "none",
				items: [],
			}),
		]);
		expect(dormant.latest()?.hiddenReason).toBeUndefined();

		const viewed = fakeSlotHost();
		const reclaimed = createNextTurnPlugin({
			startRuntime: () => fakeRuntime(),
			lifecycle: alwaysActive,
		});
		await reclaimed.setup?.(viewed.api as never, slotContext(viewed));
		expect(viewed.states).toEqual([]);
	});

	test("a chat restarted after its last viewer left announces the new copy at setup, so the renderer still bound to it attaches and is served", async () => {
		const settings = defaultSettings();
		settings.notify.needsYou = false;
		settings.planner.callsPerHour = 0;
		const workspaceRoot = tempDir();
		const copy = () => {
			const host = fakeSlotHost();
			const disposers: Array<() => unknown> = [];
			let started: SessionRuntime | undefined;
			const plugin = createNextTurnPlugin({
				startRuntime: (startContext, { active }) => {
					started = startSessionRuntime(startContext, {
						settings: () => settings,
						active,
						hubLink: offlineHub,
						runCommand: noCommands,
					});
					return started;
				},
				lifecycle: alwaysActive,
			});
			const setup = () =>
				plugin.setup?.(
					host.api as never,
					slotContext(host, {
						session: { sessionId: "sess_restarted_unviewed" },
						workspaceInfo: { rootPath: workspaceRoot },
						onDispose: (cleanup) => {
							disposers.push(cleanup);
						},
					}),
				);
			const dispose = () => Promise.all(disposers.map((cleanup) => cleanup()));
			return { host, plugin, setup, dispose, runtime: () => started };
		};

		const before = copy();
		await before.setup();
		before.host.invoke({ verb: "attach", surface: "desktop" });
		await agentFor(before.plugin).run("Add a retry to the client");
		await before.runtime()?.next?.settled();
		const shown = before.host.latest();
		expect(shown?.status).toBe("ready");
		before.host.invoke({ verb: "detach" });
		await before.dispose();

		const after = copy();
		try {
			await after.setup();
			expect(after.host.states).toEqual([
				expect.objectContaining({ status: "hidden", revision: "none" }),
			]);
			expect(after.host.latest()?.hiddenReason).toBeUndefined();
			expect(after.host.invoke({ verb: "attach", surface: "desktop" })).toEqual(
				{ outcome: "ok" },
			);
			await flushDetached();
			await after.runtime()?.next?.settled();
			expect(after.host.latest()).toMatchObject({
				status: "ready",
				revision: shown?.revision,
			});
		} finally {
			await after.dispose();
		}
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

	test("a viewer who leaves while a turn is served gets no planner call or connector refresh for it", async () => {
		let planned = 0;
		let refreshed = 0;
		const connectors = {
			onTurn: async () => {
				refreshed += 1;
			},
		} as unknown as SessionRuntime["connectors"];
		let gitRead: () => void = () => {};
		const reading = new Promise<void>((resolve) => {
			gitRead = resolve;
		});
		let releaseGit: () => void = () => {};
		const host = fakeSlotHost();
		const { next, start } = presence(
			{
				dirtyFiles: () => {
					gitRead();
					return new Promise((resolve) => {
						releaseGit = () => resolve(1);
					});
				},
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
		host.invoke({ verb: "attach", surface: "desktop" });
		const run = agentFor(plugin).run("Add a retry to the client");
		await reading;
		host.invoke({ verb: "detach" });
		releaseGit();
		await run;
		await next.settled();
		await flushDetached();
		expect([planned, refreshed]).toEqual([0, 0]);
		expect(next.current()).toBeUndefined();
		expect(next.currentPush().state).toBe("computing");
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
