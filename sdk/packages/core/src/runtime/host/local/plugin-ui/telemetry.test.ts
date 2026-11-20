import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_TELEMETRY_EVENTS } from "../../../../services/telemetry/core-events";
import {
	attach,
	createHarness,
	PLUGIN,
	readyState,
	SLOT,
	skip,
} from "./service.fixtures";

describe("PluginUiService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("never throws when the telemetry sink does, and still tells the plugin", async () => {
		const harness = createHarness();
		harness.capture.mockImplementation(() => {
			throw new Error("telemetry down");
		});
		const { epoch, onAction } = harness.start("s1");

		await expect(harness.invoke("s1", attach)).resolves.toEqual({
			outcome: "ok",
			epoch,
		});
		await expect(harness.invoke("s1", skip)).resolves.toEqual({
			outcome: "ok",
			epoch,
		});
		await expect(
			harness.service.closeSession("s1", epoch),
		).resolves.toBeUndefined();

		expect(
			onAction.mock.calls.map(([action, context]) => [
				action.verb,
				context.viewers,
			]),
		).toEqual([
			["attach", 1],
			["skip", 1],
			["detach", 0],
		]);
	});

	it("sends invoke telemetry only for gestures and one summary per session at close", async () => {
		const harness = createHarness();
		const { epoch } = harness.start("s1", {
			onAction: () => {
				harness.service.record("s1", epoch, {
					plugin: PLUGIN,
					slot: SLOT,
					state: readyState("r1"),
				});
			},
		});

		await harness.invoke("s1", attach, { id: "a" });
		await harness.invoke("s1", { verb: "attach", surface: "cli" }, { id: "b" });
		await harness.invoke(
			"s1",
			{ verb: "exposed", revision: "r1", itemIds: ["fix"] },
			{ id: "a" },
		);
		await harness.invoke(
			"s1",
			{ verb: "signal", name: "key_inert", reason: "not_exposed" },
			{ id: "a" },
		);
		await harness.invoke("s1", skip, { id: "a" });
		await harness.invoke("s1", { verb: "detach" }, { id: "b" });
		await harness.service.closeSession("s1", epoch);

		expect(harness.events(CORE_TELEMETRY_EVENTS.PLUGIN_UI.INVOKE)).toEqual([
			{
				plugin_name: PLUGIN,
				slot: SLOT,
				verb: "skip",
				outcome: "ok",
				latency_ms: 0,
				surface: "desktop",
			},
		]);
		expect(
			harness.events(CORE_TELEMETRY_EVENTS.PLUGIN_UI.SESSION_SUMMARY),
		).toEqual([
			{
				plugin_name: PLUGIN,
				slot: SLOT,
				attaches: 2,
				detaches: 2,
				exposed: 1,
				key_inert: 1,
				peak_viewers: 2,
				surfaces: ["cli", "desktop"],
			},
		]);
		expect(
			harness.events(CORE_TELEMETRY_EVENTS.PLUGIN_UI.VIEWERS_CHANGED),
		).toEqual([
			{ slot: SLOT, count: 1, surface: "desktop" },
			{ slot: SLOT, count: 0, surface: "desktop" },
		]);
	});

	it("reports dropped state at most once per session, plugin and reason a minute", async () => {
		const harness = createHarness();
		const { epoch } = harness.start("s1");
		const bigint = { plugin: PLUGIN, slot: SLOT, state: { n: BigInt(1) } };

		harness.service.record("s1", epoch, bigint);
		harness.service.record("s1", epoch, bigint);
		harness.service.record("s1", epoch, { ...bigint, state: { status: 1 } });
		await vi.advanceTimersByTimeAsync(60_000);
		harness.service.record("s1", epoch, bigint);

		expect(
			harness.events(CORE_TELEMETRY_EVENTS.PLUGIN_UI.STATE_DROPPED),
		).toEqual([
			{ plugin_name: PLUGIN, slot: SLOT, reason: "unserializable" },
			{ plugin_name: PLUGIN, slot: SLOT, reason: "invalid" },
			{ plugin_name: PLUGIN, slot: SLOT, reason: "unserializable" },
		]);
	});
});
