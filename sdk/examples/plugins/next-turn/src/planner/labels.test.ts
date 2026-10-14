import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LABEL_SCHEMA_VERSION, TYPED_TEXT_LIMIT } from "../config";
import { PRIVATE_FILE_MODE } from "../store/data-dir";
import { useTempDirs } from "../test-support";
import { suggestion } from "./candidates";
import {
	buildLabelRecord,
	editBucket,
	LABEL_EVENTS,
	LabelLog,
	type Offer,
	offerRecord,
} from "./labels";

const tempDir = useTempDirs("next-turn-labels-");

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
		const long = buildLabelRecord({
			...base,
			event: "typed_instead",
			typedText: "x".repeat(TYPED_TEXT_LIMIT + 5),
		});
		expect(long.chars).toBe(TYPED_TEXT_LIMIT);
		expect(long.messageHash).toBe(
			buildLabelRecord({
				...base,
				event: "typed_instead",
				typedText: "x".repeat(TYPED_TEXT_LIMIT),
			}).messageHash,
		);
	});

	test("a named field left undefined is not written; an unknown key is refused even when undefined", () => {
		const record = buildLabelRecord({
			...base,
			event: "skip",
			input: undefined,
			candidateId: "c1",
		});
		expect(record).toEqual({ ...base, event: "skip", candidateId: "c1" });
		expect("input" in record).toBe(false);
		expect(() =>
			buildLabelRecord({ ...base, event: "skip", why: undefined }),
		).toThrow("why is not a field the label schema names");
	});

	test("the writer refuses what the published schema refuses", () => {
		expect(() =>
			buildLabelRecord({ ...base, event: "offer", trigger: "foo" }),
		).toThrow("trigger must be one of after_run, on_demand");
		expect(() =>
			buildLabelRecord({ ...base, at: "yesterday", event: "offer" }),
		).toThrow("at must be a timestamp string");
		expect(() =>
			buildLabelRecord({ ...base, event: "adjust", bucket: "medium" }),
		).toThrow("bucket must be one of same, small, large");
		expect(() =>
			buildLabelRecord({ ...base, event: "skip", constructor: "prose" }),
		).toThrow("constructor is not a field the label schema names");
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
		expect(Object.keys(record)).toEqual([
			"v",
			"at",
			"sessionId",
			"event",
			"candidateIds",
			"kinds",
			"sources",
			"tags",
			"setId",
			"turnKey",
			"offerId",
			"runId",
			"cueCode",
			"turnStatus",
			"planner",
			"runCount",
			"candidateCount",
			"filesEdited",
			"latencyMs",
			"excludedCount",
			"toolErrored",
			"fallback",
			"reroll",
		]);

		const onDemandOffer: Offer = {
			...offer,
			runId: undefined,
			trigger: "on_demand",
		};
		const onDemandRecord = buildLabelRecord(
			offerRecord(onDemandOffer, {
				turn: { status: "completed", filesEdited: 1, toolErrored: false },
				latencyMs: 8,
				tags: [],
				at: new Date(0),
			}),
		);
		expect(onDemandRecord.trigger).toBe("on_demand");
		expect(onDemandRecord.runId).toBeUndefined();
	});

	test("the log appends owner-only lines and mirrors each accepted record", () => {
		const path = join(tempDir(), "labels.jsonl");
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
