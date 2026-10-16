import { describe, expect, test } from "bun:test";
import type { ContextSource } from "../../context/source";
import { defaultSettings } from "../../settings/settings";
import { FileSessionStateStore } from "../../store/session-state";
import { editRun, message, runResult } from "../../test-support/agent-runs";
import { useTempDirs } from "../../test-support/temp-dirs";
import { type Backlog, EMPTY_BACKLOG } from "../backlog";
import type { Complete } from "../model/model";
import { MODEL_ANSWER, sessionHarness, sources } from "./session.fixtures";

const tempDir = useTempDirs("next-turn-session-");
const harness = sessionHarness(tempDir);

describe("Next under overlapping actions", () => {
	test("a reroll right after a respawn keeps the capabilities the turn saved while its sources load", async () => {
		const store = new FileSessionStateStore(
			tempDir("respawn-capabilities-"),
			"sess_1",
		);
		let loaded = true;
		const linear: ContextSource = {
			id: "pinned-linear",
			tier: "T0",
			probe: () => "present",
			capabilities: () => (loaded ? ["mcp:linear"] : []),
		};
		const first = harness({ store, sources: () => [...sources, linear] });
		await first.session.afterRun(editRun().result);
		await first.session.settled();
		expect(first.calls[0]).toContain("mcp:linear");
		loaded = false;
		const respawned = harness({ store, sources: () => [...sources, linear] });
		respawned.session.invoke({ type: "reroll" });
		await respawned.session.settled();
		expect(respawned.calls[0]).toContain("mcp:linear");
	});

	test("a connector turned off after a respawn is no longer named to the planner or offered", async () => {
		const store = new FileSessionStateStore(tempDir("respawn-off-"), "sess_1");
		const linear: ContextSource = {
			id: "mcp:linear",
			tier: "T0",
			probe: () => "present",
			capabilities: () => ["mcp:linear"],
		};
		const systems: string[] = [];
		const asked =
			(users: string[]): Complete =>
			async (input) => {
				users.push(input.user);
				systems.push(input.system);
				return { text: MODEL_ANSWER };
			};
		const firstCalls: string[] = [];
		const first = harness({
			store,
			sources: () => [...sources, linear],
			complete: asked(firstCalls),
		});
		await first.session.afterRun(editRun().result);
		await first.session.settled();
		expect(firstCalls[0]).toContain("mcp:linear");
		expect(systems[0]).toContain("update_issue");

		const settings = defaultSettings();
		settings.connectors["mcp:linear"] = { role: "off", scopes: [] };
		const respawnedCalls: string[] = [];
		const respawned = harness(
			{
				store,
				sources: () => [...sources, linear],
				complete: asked(respawnedCalls),
			},
			settings,
		);
		respawned.session.invoke({ type: "reroll" });
		await respawned.session.settled();
		expect(respawnedCalls).toHaveLength(1);
		expect(respawnedCalls[0]).not.toContain("mcp:linear");
		expect(systems[1]).not.toContain("update_issue");
		const tags = respawned
			.labels()
			.filter((record) => record.event === "offer")
			.at(-1)?.tags;
		expect(tags).toContain("source:mcp:linear:off");
		expect(tags).not.toContain("cap:mcp:linear");
	});

	test("a connector set to Off before the respawned worker detects it is no longer named to the planner or offered", async () => {
		const store = new FileSessionStateStore(
			tempDir("respawn-undetected-off-"),
			"sess_1",
		);
		const linear: ContextSource = {
			id: "mcp:linear",
			tier: "T0",
			probe: () => "present",
			capabilities: () => ["mcp:linear"],
		};
		const first = harness({ store, sources: () => [...sources, linear] });
		await first.session.afterRun(editRun().result);
		await first.session.settled();
		expect(first.calls[0]).toContain("mcp:linear");

		const settings = defaultSettings();
		settings.connectors["mcp:linear"] = { role: "off", scopes: [] };
		const respawned = harness({ store }, settings);
		respawned.session.invoke({ type: "reroll" });
		await respawned.session.settled();
		expect(respawned.calls).toHaveLength(1);
		expect(respawned.calls[0]).not.toContain("mcp:linear");
		const tags = respawned
			.labels()
			.filter((record) => record.event === "offer")
			.at(-1)?.tags;
		expect(tags).toContain("source:mcp:linear:off");
		expect(tags).not.toContain("cap:mcp:linear");
	});

	test("a source turned off while its inventory still loads after a respawn takes what it named out of the planner's capabilities", async () => {
		const store = new FileSessionStateStore(
			tempDir("respawn-loading-off-"),
			"sess_1",
		);
		let loaded = true;
		const setup: ContextSource = {
			id: "cline-setup",
			tier: "T2",
			settingsToggle: "clineSetup",
			probe: () => (loaded ? "present" : "unknown"),
			capabilities: () => (loaded ? ["workflow:/release", "mcp:sentry"] : []),
		};
		const linear: ContextSource = {
			id: "pinned-linear",
			tier: "T0",
			probe: () => "present",
			capabilities: () => (loaded ? ["mcp:linear"] : []),
		};
		const withSetup = () => [...sources, setup, linear];
		const first = harness({ store, sources: withSetup });
		await first.session.afterRun(editRun().result);
		await first.session.settled();
		expect(first.calls[0]).toContain("mcp:sentry");

		loaded = false;
		const settings = defaultSettings();
		settings.context.clineSetup = false;
		const respawned = harness({ store, sources: withSetup }, settings);
		respawned.session.invoke({ type: "reroll" });
		await respawned.session.settled();
		expect(respawned.calls).toHaveLength(1);
		expect(respawned.calls[0]).toContain("mcp:linear");
		expect(respawned.calls[0]).not.toContain("mcp:sentry");
		expect(respawned.calls[0]).not.toContain("workflow:/release");
		const tags = respawned
			.labels()
			.filter((record) => record.event === "offer")
			.at(-1)?.tags;
		expect(tags).toContain("source:cline-setup:off");
		expect(tags).not.toContain("cap:mcp:sentry");
		expect(tags).not.toContain("cap:workflow:/release");
	});

	test("a session rebuilt after a respawn keeps its manifest and trigger, and reads the backlog again before asking the planner", async () => {
		const store = new FileSessionStateStore(tempDir("respawn-"), "sess_1");
		let backlogReads = 0;
		const backlog = async (): Promise<Backlog> => {
			backlogReads += 1;
			return {
				...EMPTY_BACKLOG,
				tasks: [
					{
						taskId: "t1",
						title: "Ship the tray",
						status: "approved",
						priority: 2,
						updatedAt: 1,
					},
				],
			};
		};
		const first = harness({ store, backlog });
		await first.session.afterRun(editRun().result);
		await first.session.settled();
		expect(first.session.current()?.planner).toBe("model");
		const respawned = harness({ store, backlog });
		respawned.session.invoke({ type: "reroll" });
		await respawned.session.settled();
		expect(backlogReads).toBe(2);
		expect(respawned.calls).toHaveLength(1);
		expect(respawned.calls[0]).toContain("Ship the tray");
		const offers = respawned
			.labels()
			.filter((record) => record.event === "offer");
		expect(offers.length).toBeGreaterThan(0);
		for (const offer of offers) {
			expect(offer.trigger).toBe("after_run");
			expect(offer.tags).toEqual(
				expect.arrayContaining(["source:tasks:present"]),
			);
		}
	});

	test("a Use made before a respawn labels the edited message against the row it used", async () => {
		const store = new FileSessionStateStore(tempDir("intent-"), "sess_1");
		const first = harness({ store, complete: undefined });
		const { result, messages } = editRun();
		const set = await first.session.afterRun(result);
		const used = set?.candidates[0];
		first.session.invoke({
			type: "use",
			candidateId: used?.id ?? "",
			offerId: set?.offerId,
			input: "key",
		});
		const respawned = harness({ store, complete: undefined });
		respawned.session.outgoing([
			...messages,
			message("user", `${used?.prompt} now`),
		]);
		expect(respawned.labels().map((record) => record.event)).toEqual([
			"adjust_sent",
			"superseded",
		]);
		expect(respawned.labels()[0]).toMatchObject({
			offerId: set?.offerId,
			candidateId: used?.id,
			input: "key",
		});
	});

	test("hiding the chat while the tray is already off still holds after a respawn", async () => {
		const dir = tempDir("hide-");
		const first = harness({
			store: new FileSessionStateStore(dir, "sess_1"),
			complete: undefined,
		});
		first.session.off();
		first.session.invoke({ type: "hide", scope: "chat" });
		const respawned = harness({
			store: new FileSessionStateStore(dir, "sess_1"),
			complete: undefined,
		});
		await respawned.session.afterRun(editRun().result);
		await respawned.session.settled();
		expect(respawned.sets.filter(Boolean)).toEqual([]);
		expect(respawned.session.currentPush().state).toBe("off");
	});

	test("a saved turn that does not restore leaves the session without a set instead of failing", () => {
		const store = new FileSessionStateStore(tempDir("malformed-"), "sess_1");
		store.write({ seq: 4, turnState: { excludedIds: 7 } as never });
		const { session } = harness({ store, complete: undefined });
		expect(session.current()).toBeUndefined();
		expect(session.currentPush()).toMatchObject({ seq: 4, state: "off" });
	});

	test("a reroll still waiting on the planner when its worker stopped is answered after the respawn, by the planner or by the next page", async () => {
		const stalledReroll = async (label: string) => {
			const store = new FileSessionStateStore(tempDir(label), "sess_1");
			let asked = 0;
			const first = harness({
				store,
				complete: async () => {
					asked += 1;
					if (asked > 1) return new Promise(() => {});
					return { text: MODEL_ANSWER, costUsd: 0.001 };
				},
			});
			await first.session.afterRun(editRun().result);
			await first.session.settled();
			const shown = first.session.current();
			expect(
				first.session.invoke({
					type: "reroll",
					offerId: shown?.offerId,
					input: "key",
				}).push,
			).toMatchObject({ state: "computing", computingFor: "reroll" });
			first.session.dispose();
			return { store, shown };
		};

		const asksAgain = await stalledReroll("reroll-planner-");
		const respawned = harness({ store: asksAgain.store });
		await respawned.session.settled();
		expect(respawned.calls).toHaveLength(1);
		expect(respawned.session.currentPush()).toMatchObject({
			set: { planner: "model", rerollsLeft: 1 },
		});
		expect(respawned.session.currentPush().state).not.toBe("computing");
		expect(respawned.session.current()?.offerId).not.toBe(
			asksAgain.shown?.offerId,
		);
		expect(
			respawned.session.invoke({ type: "reroll", input: "key" }).refused,
		).toBeUndefined();
		await respawned.session.settled();

		const noPlanner = await stalledReroll("reroll-rules-");
		const rules = harness({ store: noPlanner.store, complete: undefined });
		expect(rules.session.currentPush().state).not.toBe("computing");
		expect(rules.session.current()?.offerId).not.toBe(noPlanner.shown?.offerId);
		expect(rules.session.current()?.rerollsLeft).toBe(1);
	});

	test("a turn whose first set a respawn cut off is served on demand, not the set before it", async () => {
		const store = new FileSessionStateStore(tempDir("serve-cut-"), "sess_1");
		const first = harness({ store, complete: undefined });
		const run = editRun();
		const earlier = await first.session.afterRun(run.result);
		const cutOff = first.session.afterRun(
			runResult([
				...run.messages,
				message("assistant", "Done."),
				message("user", "Now the parser"),
				message("assistant", "Fixed the parser."),
			]),
		);
		first.session.dispose();
		expect(await cutOff).toBeUndefined();

		const respawned = harness({ store, complete: undefined });
		expect(respawned.session.current()).toBeUndefined();
		expect(await respawned.session.ensureCurrent()).toMatchObject({
			state: "ready",
			set: { runCount: 2, trigger: "on_demand" },
		});
		expect(respawned.session.current()?.offerId).not.toBe(earlier?.offerId);
	});
});
