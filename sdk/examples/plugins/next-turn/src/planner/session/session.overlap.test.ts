import { describe, expect, test } from "bun:test";
import type { ContextSource } from "../../context/source";
import { defaultSettings } from "../../settings/settings";
import {
	FileSessionStateStore,
	updateSessionState,
} from "../../store/session-state";
import { editRun, message, runResult } from "../../test-support/agent-runs";
import { useTempDirs } from "../../test-support/temp-dirs";
import type { Backlog } from "../backlog";
import { type Complete, plannerProvider } from "../model/model";
import { deriveTurn } from "../turn/turn";
import { MODEL_ANSWER, sessionHarness, sources } from "./session.fixtures";

const tempDir = useTempDirs("next-turn-session-");
const harness = sessionHarness(tempDir);

describe("Next under overlapping actions", () => {
	test("hiding the chat while a set is computing keeps the tray off", async () => {
		const { session, sets } = harness();
		const served = session.afterRun(editRun().result);
		session.invoke({ type: "hide", scope: "chat" });
		expect(await served).toBeUndefined();
		await session.settled();
		expect(sets.filter(Boolean)).toEqual([]);
		expect(session.current()).toBeUndefined();
		expect(session.currentPush().state).toBe("off");
	});

	test("a turn that ends while the planner is still answering the last one stays within the allowance", async () => {
		const settings = defaultSettings();
		settings.planner.callsPerHour = 1;
		let release: () => void = () => {};
		const answered = new Promise<void>((resolve) => {
			release = resolve;
		});
		let dispatched: () => void = () => {};
		const asking = new Promise<void>((resolve) => {
			dispatched = resolve;
		});
		let asked = 0;
		const { session, ledgerCalls } = harness(
			{
				complete: async () => {
					asked += 1;
					dispatched();
					await answered;
					return { text: MODEL_ANSWER, costUsd: 0.001 };
				},
			},
			settings,
		);
		await session.afterRun(editRun().result);
		await asking;
		const second = await session.afterRun(editRun("And now a timeout").result);
		release();
		await session.settled();
		expect(asked).toBe(1);
		expect(second?.paused?.resetsAt).toBeGreaterThan(0);
		expect(ledgerCalls()).toHaveLength(1);
	});

	test("a reroll after the planner moves to another provider leaves other chats out", async () => {
		const settings = defaultSettings();
		const history: ContextSource = {
			id: "history",
			tier: "T2",
			settingsToggle: "history",
			readsOtherChats: true,
			probe: () => "present",
			facts: () => ({
				heading: "Related chats in this workspace",
				lines: ['"Secret payroll migration" · 2h ago · idle'],
			}),
		};
		const sent: { providerId?: string; user: string }[] = [];
		const { session } = harness(
			{
				sources: () => [...sources, history],
				complete: async (input, _signal, planned) => {
					sent.push({
						providerId: plannerProvider(planned, session.chat()).providerId,
						user: input.user,
					});
					return { text: MODEL_ANSWER };
				},
			},
			settings,
		);
		const ask = message("user", "Add a retry to the client");
		const reply = message("assistant", "Added the retry.", {
			modelInfo: { provider: "anthropic", id: "claude" },
		});
		await session.afterRun(runResult([ask, reply]));
		await session.settled();
		expect(sent[0]?.providerId).toBe("anthropic");
		expect(sent[0]?.user).toContain("Secret payroll migration");
		settings.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "gpt",
		};
		session.invoke({ type: "reroll" });
		await session.settled();
		expect(sent[1]?.providerId).toBe("openai");
		expect(sent[1]?.user).not.toContain("Secret payroll migration");
	});

	test("a reroll after a script is removed no longer names it to the planner", async () => {
		let scripts = ["script:test", "script:lint"];
		const repo: ContextSource = {
			id: "repo-scripts",
			tier: "T0",
			probe: () => "present",
			capabilities: () => scripts,
		};
		const sent: string[] = [];
		const { session } = harness({
			sources: () => [...sources, repo],
			complete: async (input) => {
				sent.push(input.user);
				return { text: MODEL_ANSWER };
			},
		});
		await session.afterRun(editRun().result);
		await session.settled();
		expect(sent[0]).toContain("script:lint");
		scripts = ["script:test"];
		session.invoke({ type: "reroll" });
		await session.settled();
		expect(sent[1]).toContain("script:test");
		expect(sent[1]).not.toContain("script:lint");
	});

	test("a model set is tagged with the manifest its planner call saw", async () => {
		const settings = defaultSettings();
		const history: ContextSource = {
			id: "history",
			tier: "T2",
			settingsToggle: "history",
			readsOtherChats: true,
			probe: () => "present",
			facts: () => ({
				heading: "Related chats in this workspace",
				lines: ['"Secret payroll migration" · 2h ago · idle'],
			}),
		};
		const { session, labels } = harness(
			{ sources: () => [...sources, history] },
			settings,
		);
		const ask = message("user", "Add a retry to the client");
		const reply = message("assistant", "Added the retry.", {
			modelInfo: { provider: "anthropic", id: "claude" },
		});
		await session.afterRun(runResult([ask, reply]));
		await session.settled();
		settings.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "gpt",
		};
		session.invoke({ type: "reroll" });
		await session.settled();
		const tags = labels()
			.filter((record) => record.event === "offer")
			.map((record) => record.tags);
		expect(tags[0]).toContain("source:history:present");
		expect(tags.at(-1)).toContain("source:history:off");
		expect(tags.at(-1)).not.toContain("source:history:present");
	});

	test("a reroll while the planner is still answering asks the model once", async () => {
		let release: () => void = () => {};
		const answered = new Promise<void>((resolve) => {
			release = resolve;
		});
		let asked = 0;
		const complete: Complete = async () => {
			asked += 1;
			await answered;
			return { text: MODEL_ANSWER, costUsd: 0.001 };
		};
		const { session, ledgerCalls } = harness({ complete });
		await session.afterRun(editRun().result);
		session.invoke({ type: "reroll" });
		release();
		await session.settled();
		expect(asked).toBe(1);
		expect(ledgerCalls()).toHaveLength(1);
	});

	test("an off push takes the next number in the session's own sequence, once", async () => {
		const { session } = harness({ complete: undefined });
		await session.afterRun(editRun().result);
		const before = session.currentPush().seq;
		const off = session.off();
		expect(off).toMatchObject({ seq: before + 1, state: "off" });
		expect(session.off()).toBe(off);
		expect(session.currentPush()).toBe(off);
	});

	test("a viewer that asks for the set after Next was turned off gets a newer off push, and the set is dropped", async () => {
		const settings = defaultSettings();
		const { session } = harness({ complete: undefined }, settings);
		await session.afterRun(editRun().result);
		const ready = session.currentPush();
		expect(ready.state).toBe("ready");
		settings.features.next = false;
		const reply = await session.ensureCurrent();
		expect(reply).toMatchObject({ state: "off", seq: ready.seq + 1 });
		expect(session.current()).toBeUndefined();
		expect(await session.ensureCurrent()).toBe(reply);
	});

	test("turning off drops the set and the planner's late answer, so turning back on serves the turn again", async () => {
		let release: () => void = () => {};
		const answered = new Promise<void>((resolve) => {
			release = resolve;
		});
		const complete: Complete = async () => {
			await answered;
			return { text: MODEL_ANSWER, costUsd: 0.001 };
		};
		const { session, sets } = harness({ complete });
		await session.afterRun(editRun().result);
		const off = session.off();
		release();
		await session.settled();
		expect(sets.filter(Boolean)).toEqual([]);
		expect(session.currentPush().state).toBe("off");
		const reply = await session.ensureCurrent();
		expect(reply.state).toBe("computing");
		expect(reply.seq).toBeGreaterThan(off.seq);
		await session.settled();
		expect(session.currentPush().state).toBe("ready");
		expect(sets.filter(Boolean)).toHaveLength(1);
	});

	test("asking for the current set while the turn is still being served waits for that serve", async () => {
		const { session, labels } = harness({ complete: undefined });
		const states: string[] = [];
		session.onPush((push) => states.push(push.state));
		const served = session.afterRun(editRun().result);
		const reply = await session.ensureCurrent();
		await served;
		expect(reply.state).toBe("ready");
		expect(states).toEqual(["computing", "ready"]);
		expect(
			labels()
				.filter((record) => record.event === "offer")
				.map((record) => record.trigger),
		).toEqual(["after_run"]);
	});

	test("hiding the chat while a viewer's set is read from the transcript keeps the tray off", async () => {
		let release: () => void = () => {};
		const read = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { messages } = editRun("Forked chat turn");
		const { session } = harness({
			complete: undefined,
			readTranscript: async () => {
				await read;
				return { messages, status: "completed" };
			},
		});
		const reply = session.ensureCurrent();
		session.invoke({ type: "hide", scope: "chat" });
		release();
		expect((await reply).state).toBe("off");
		expect(session.current()).toBeUndefined();
	});

	test("a viewer that opens a chat while its run is still going gets no set until the run ends", async () => {
		const { messages } = editRun("Fix the parser");
		const opened = harness({
			readTranscript: async () => ({ messages, status: "running" }),
		});
		expect((await opened.session.ensureCurrent()).state).toBe("off");
		await opened.session.settled();
		expect(opened.calls).toEqual([]);
		expect(opened.sets.filter(Boolean)).toEqual([]);

		const live = harness({ complete: undefined });
		const first = editRun();
		await live.session.afterRun(first.result);
		live.session.outgoing([
			...first.messages,
			message("user", "Now the parser"),
		]);
		expect((await live.session.ensureCurrent()).state).toBe("off");
		expect(live.session.current()).toBeUndefined();
	});

	test("a Next that starts while the chat's next run is going (a dormant chat's viewer, a respawn) serves nothing from the turn before it", async () => {
		const first = editRun("Fix the parser");
		const storeWithFirstTurn = (label: string) => {
			const store = new FileSessionStateStore(tempDir(label), "sess_1");
			updateSessionState(store, {
				lastTurn: deriveTurn("sess_1", first.result) ?? undefined,
			});
			return store;
		};
		const secondRun = [
			...first.messages,
			message("assistant", "Fixed."),
			message("user", "Now the lexer"),
		];
		let transcript = { messages: secondRun, status: "running" };
		const started = harness({
			store: storeWithFirstTurn("mid-run-"),
			readTranscript: async () => transcript,
		});
		expect((await started.session.ensureCurrent()).state).toBe("off");
		await started.session.settled();
		expect(started.calls).toEqual([]);
		expect(started.ledgerCalls()).toEqual([]);
		expect(started.sets.filter(Boolean)).toEqual([]);

		transcript = {
			messages: [...secondRun, message("assistant", "Done.")],
			status: "idle",
		};
		await started.session.ensureCurrent();
		await started.session.settled();
		expect(started.session.currentPush()).toMatchObject({
			state: "ready",
			set: { runCount: 2, trigger: "on_demand" },
		});

		const caughtUp = harness({
			store: storeWithFirstTurn("caught-up-"),
			readTranscript: async () => ({
				messages: first.messages,
				status: "idle",
			}),
		});
		await caughtUp.session.ensureCurrent();
		await caughtUp.session.settled();
		expect(caughtUp.session.currentPush()).toMatchObject({
			state: "ready",
			set: { runCount: 1, runId: first.result.runId },
		});
	});

	test("a tray action that lands while the next turn is computing is refused, not applied to the previous set", async () => {
		const { session, labels } = harness({ complete: undefined });
		const first = await session.afterRun(editRun().result);
		const served = session.afterRun(editRun("Second turn").result);
		const reply = session.invoke({
			type: "skip",
			candidateId: first?.candidates[0]?.id ?? "",
			offerId: first?.offerId,
		});
		expect(reply).toMatchObject({
			push: { state: "computing", computingFor: "turn" },
			refused: "stale",
		});
		expect(labels().find((r) => r.event === "refused_stale")).toMatchObject({
			reason: "computing",
			offerId: first?.offerId,
		});
		expect(labels().some((r) => r.event === "skip")).toBe(false);
		expect((await served)?.offerId).not.toBe(first?.offerId);
		expect(session.currentPush().state).toBe("ready");
	});

	test("a serve that fails leaves the tray unavailable, and a viewer's current gets that push", async () => {
		const failing = async (): Promise<Backlog> => {
			throw new Error("backlog unreadable");
		};
		const { session } = harness({ complete: undefined, backlog: failing });
		expect(await session.afterRun(editRun().result)).toBeUndefined();
		expect(session.currentPush()).toMatchObject({
			state: "unavailable",
			error: "backlog unreadable",
		});
		const { messages } = editRun("Forked chat turn");
		const viewed = harness({
			complete: undefined,
			backlog: failing,
			readTranscript: async () => ({ messages, status: "completed" }),
		});
		expect((await viewed.session.ensureCurrent()).state).toBe("unavailable");
	});

	test("when the planner fails, the set on screen keeps its tray state and reports the error, and a reroll waiting on it gets the rules' next page", async () => {
		let asked = 0;
		const { session, sets } = harness({
			complete: async () => {
				asked += 1;
				return { text: "not json" };
			},
			dirtyFiles: undefined,
		});
		await session.afterRun(editRun().result);
		await session.settled();
		expect(session.currentPush()).toMatchObject({
			state: "ready",
			set: { model: { status: "error" } },
		});
		expect(sets).toHaveLength(1);
		expect(session.invoke({ type: "reroll" }).push).toMatchObject({
			state: "computing",
			computingFor: "reroll",
		});
		await session.settled();
		expect(asked).toBe(2);
		expect(session.currentPush()).toMatchObject({
			state: "empty",
			set: { candidates: [], model: { status: "error" } },
		});
		session.invoke({ type: "reroll" });
		await session.settled();
		expect(asked).toBe(3);
		expect(session.currentPush()).toMatchObject({
			state: "exhausted",
			set: { candidates: [], model: { status: "error" } },
		});
		expect(sets).toHaveLength(3);
	});

	test("a disposed session installs no set from a serve already under way", async () => {
		const { session } = harness({ complete: undefined });
		const served = session.afterRun(editRun().result);
		session.dispose();
		expect(await served).toBeUndefined();
		expect(session.current()).toBeUndefined();
	});
});
