import { describe, expect, test } from "bun:test";
import type { ITelemetryService } from "@cline/shared";
import { LABEL_SCHEMA_VERSION } from "../config";
import { buildLabelRecord, LABEL_EVENTS } from "./labels";
import { captureLabel, surfaceOf } from "./telemetry";

type Captured = { event: string; properties?: Record<string, unknown> };
type Recorded = { name: string; value: number };

const base = {
	v: LABEL_SCHEMA_VERSION,
	at: "2026-10-08T00:00:00.000Z",
	sessionId: "sess_1",
};

function service(fail = false) {
	const captured: Captured[] = [];
	const histograms: Recorded[] = [];
	const telemetry = {
		capture: (event: Captured) => {
			if (fail) throw new Error("exporter down");
			captured.push(event);
		},
		recordCounter: () => undefined,
		recordHistogram: (name: string, value: number) =>
			histograms.push({ name, value }),
	} as unknown as ITelemetryService;
	return { telemetry, captured, histograms };
}

describe("the telemetry mirror", () => {
	test("names each label by what the person did and drops the hash", () => {
		const { telemetry, captured, histograms } = service();
		captureLabel(
			telemetry,
			"terminal-tray",
			buildLabelRecord({ ...base, event: "typed_instead", typedText: "x" }),
		);
		captureLabel(
			telemetry,
			"terminal-tray",
			buildLabelRecord({
				...base,
				event: "offer",
				latencyMs: 30,
				planner: "model",
			}),
		);
		captureLabel(
			telemetry,
			"plugin",
			buildLabelRecord({
				...base,
				event: "skip",
				excluded: ["a"],
				msSinceExposed: 900,
			}),
		);
		expect(captured.map((event) => event.event)).toEqual([
			"next_turn.typed_instead",
			"next_turn.set_served",
			"next_turn.skipped",
		]);
		expect(captured[0]?.properties?.messageHash).toBeUndefined();
		expect(captured[0]?.properties?.surface).toBe("terminal-tray");
		expect(captured[2]?.properties?.excludedCount).toBe(1);
		expect(captured[2]?.properties?.excluded).toBeUndefined();
		expect(histograms).toEqual([
			{ name: "next_turn.set_latency_ms", value: 30 },
			{ name: "next_turn.decision_ms", value: 900 },
		]);
	});

	test("every label event has a telemetry name of its own", () => {
		const { telemetry, captured } = service();
		for (const event of LABEL_EVENTS)
			captureLabel(telemetry, "plugin", buildLabelRecord({ ...base, event }));
		const names = captured.map(({ event }) => event);
		expect(new Set(names).size).toBe(LABEL_EVENTS.length);
		expect(names.filter((name) => name.endsWith(".undefined"))).toEqual([]);
	});

	test("a failing or missing service changes nothing", () => {
		const record = buildLabelRecord({ ...base, event: "exposed" });
		expect(() =>
			captureLabel(service(true).telemetry, "plugin", record),
		).not.toThrow();
		expect(() => captureLabel(undefined, "plugin", record)).not.toThrow();
	});

	test("the surface follows the client", () => {
		expect(surfaceOf("cline-desktop")).toBe("desktop-tray");
		expect(surfaceOf("cline-cli")).toBe("terminal-tray");
		expect(surfaceOf("cline-vscode")).toBe("plugin");
		expect(surfaceOf("cline-jetbrains")).toBe("plugin");
		expect(surfaceOf(undefined)).toBe("plugin");
	});
});
