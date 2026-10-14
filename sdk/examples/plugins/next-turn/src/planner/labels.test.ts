import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ITelemetryService } from "@cline/shared";
import { LABEL_SCHEMA_VERSION, PRIVATE_FILE_MODE } from "../config";
import { suggestion } from "./candidates";
import {
	buildLabelRecord,
	editBucket,
	LABEL_EVENTS,
	LabelLog,
	type Offer,
	offerRecord,
} from "./labels";
import {
	captureLabel,
	surfaceOf,
	TELEMETRY_ACTIONS,
	telemetryProperties,
} from "./telemetry";

type Captured = { event: string; properties?: Record<string, unknown> };
type Recorded = { name: string; value: number };

/**
 * Golden records from the label writer this plugin's schema v3 extends,
 * frozen in `test-fixtures/label-records.json`. The fixture records are v2;
 * ours are v3 (v2 plus `tags`), so equality is checked after downgrading `v`.
 */
const labelFixture = JSON.parse(
	readFileSync(
		new URL("../../test-fixtures/label-records.json", import.meta.url),
		"utf8",
	),
) as {
	events: string[];
	cases: {
		sample: Record<string, unknown>;
		record: Record<string, unknown> | "refused";
	}[];
};

const base = {
	v: LABEL_SCHEMA_VERSION,
	at: "2026-10-08T00:00:00.000Z",
	sessionId: "sess_1",
};

describe("the label record", () => {
	test("names the frozen writer's events, and accepts and refuses what it does", () => {
		expect([...LABEL_EVENTS] as string[]).toEqual(labelFixture.events);
		for (const fixture of labelFixture.cases) {
			const sample = fixture.sample;
			const ours = (() => {
				try {
					return buildLabelRecord({ ...base, ...sample });
				} catch {
					return "refused" as const;
				}
			})();
			if (fixture.record === "refused") {
				expect(ours).toBe("refused");
			} else {
				expect(ours).not.toBe("refused");
				if (ours !== "refused")
					expect({ ...ours, v: 2 } as Record<string, unknown>).toEqual(
						fixture.record,
					);
			}
		}
	});

	test("typed text is hashed, never written; tags are bounded tokens", () => {
		const record = buildLabelRecord({
			...base,
			event: "typed_instead",
			typedText: "secret plan",
		});
		expect(record.typedText).toBeUndefined();
		expect(record.messageHash).toMatch(/^[0-9a-f]{64}$/);
		expect(record.chars).toBe("secret plan".length);
		expect(() =>
			buildLabelRecord({
				...base,
				event: "offer",
				tags: ["source:tasks=present"],
			}),
		).toThrow("tags items must be tokens");
		expect(() => buildLabelRecord({ ...base, v: 2, event: "offer" })).toThrow(
			`v must be ${LABEL_SCHEMA_VERSION}`,
		);
	});

	test("the offer record carries shape and manifest tags, never text", () => {
		const offer: Offer = {
			sessionId: "sess_1",
			offerId: "offer_1",
			setId: "abcd1234",
			turnKey: "sess_1:2",
			runCount: 2,
			runId: "run_si9HsPkJ",
			cueCode: "completed_edits",
			candidates: [
				suggestion("verify", "turn", "Run the checks.", "1 file changed."),
			],
			excluded: [],
			planner: "rules",
		};
		const record = buildLabelRecord(
			offerRecord(offer, {
				turn: { status: "completed", filesEdited: 1, toolErrored: false },
				latencyMs: 12,
				fallback: false,
				tags: ["source:tasks:present", "cap:mcp:my server", "client:cline-cli"],
				at: new Date(0),
			}),
		);
		expect(record).toMatchObject({
			event: "offer",
			kinds: ["verify"],
			sources: ["turn"],
			tags: ["source:tasks:present", "client:cline-cli"],
			planner: "rules",
		});
		expect(JSON.stringify(record)).not.toContain("Run the checks");

		const onDemandOffer: Offer = {
			...offer,
			runId: undefined,
			trigger: "on_demand",
		};
		const onDemandRecord = buildLabelRecord(
			offerRecord(onDemandOffer, {
				turn: { status: "completed", filesEdited: 1, toolErrored: false },
				latencyMs: 8,
				fallback: false,
				tags: [],
				at: new Date(0),
			}),
		);
		expect(onDemandRecord.trigger).toBe("on_demand");
		expect(onDemandRecord.runId).toBeUndefined();
	});

	test("the log appends owner-only lines and mirrors each accepted record", () => {
		const path = join(
			mkdtempSync(join(tmpdir(), "next-turn-labels-")),
			"labels.jsonl",
		);
		const mirrored: unknown[] = [];
		const log = new LabelLog(path, (record) => mirrored.push(record));
		log.append({ ...base, event: "exposed" });
		expect(() =>
			log.append({ ...base, event: "exposed", why: "prose" }),
		).toThrow();
		expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
		expect(statSync(path).mode & 0o777).toBe(PRIVATE_FILE_MODE);
		expect(mirrored).toHaveLength(1);
	});

	test("the edit bucket matches the tray's", () => {
		expect(editBucket("Run the tests.", "Run the tests.")).toBe("same");
		expect(
			editBucket(
				"Run the tests in src/users.",
				"Run the tests in src/users and src/teams.",
			),
		).toBe("small");
		expect(editBucket("Run the tests.", "Deploy to staging now please")).toBe(
			"large",
		);
	});
});

describe("the telemetry mirror", () => {
	function service(enabled = true, fail = false) {
		const captured: Captured[] = [];
		const histograms: Recorded[] = [];
		const telemetry = {
			isEnabled: () => enabled,
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

	test("names each label by what the person did and drops the hash", () => {
		const { telemetry, captured, histograms } = service();
		const record = buildLabelRecord({
			...base,
			event: "typed_instead",
			typedText: "x",
		});
		captureLabel(telemetry, "terminal-tray", record);
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
		expect(captured.map((event) => event.event)).toEqual([
			"next_turn.typed_instead",
			"next_turn.set_served",
		]);
		expect(captured[0]?.properties?.messageHash).toBeUndefined();
		expect(captured[0]?.properties?.surface).toBe("terminal-tray");
		expect(histograms).toEqual([
			{ name: "next_turn.set_latency_ms", value: 30 },
		]);
		expect(Object.keys(TELEMETRY_ACTIONS).sort()).toEqual(
			[...LABEL_EVENTS].sort(),
		);
		expect(
			telemetryProperties({ ...base, event: "skip", excluded: ["a"] }, "plugin")
				.excludedCount,
		).toBe(1);
	});

	test("an opted-out or failing service changes nothing", () => {
		const off = service(false);
		captureLabel(
			off.telemetry,
			"plugin",
			buildLabelRecord({ ...base, event: "exposed" }),
		);
		expect(off.captured).toEqual([]);
		expect(() =>
			captureLabel(
				service(true, true).telemetry,
				"plugin",
				buildLabelRecord({ ...base, event: "exposed" }),
			),
		).not.toThrow();
		expect(() =>
			captureLabel(
				undefined,
				"plugin",
				buildLabelRecord({ ...base, event: "exposed" }),
			),
		).not.toThrow();
	});

	test("the surface follows the client", () => {
		expect(surfaceOf("cline-desktop")).toBe("desktop-tray");
		expect(surfaceOf("cline-cli")).toBe("terminal-tray");
		expect(surfaceOf(undefined)).toBe("plugin");
	});
});
