import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	FIXTURE_SESSION_ID,
	fixtureRecord,
	fixtureSource,
} from "./bundle.fixtures";
import { exportSessionReplayBundle } from "./bundle-export";
import {
	readSessionReplayBundle,
	validateSessionReplayBundle,
} from "./bundle-io";
import {
	buildSessionReplayIterations,
	sessionReplayIterationRunCounts,
} from "./bundle-iterations";

const COMPACTION_FILE = `sessions/${FIXTURE_SESSION_ID}/compaction.json`;

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "replay-restore-points-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function exportBundle(
	name: string,
	options: { checkpoints?: boolean; compaction?: boolean } = {},
): Promise<string> {
	const outputDir = join(root, name);
	const source = fixtureSource({
		record:
			options.checkpoints === false
				? fixtureRecord({ metadata: {} })
				: fixtureRecord(),
	});
	await exportSessionReplayBundle({
		sessionId: FIXTURE_SESSION_ID,
		outputDir,
		source: options.compaction
			? {
					...source,
					readSessionCompactionState: async () => ({
						version: 1,
						updated_at: "2026-01-01T00:00:03.000Z",
						source_message_count: 2,
						messages: [{ role: "user", content: "summary" }],
					}),
				}
			: source,
		sessionsDir: join(root, "no-sessions"),
		globalHookLogPath: join(root, "no-hooks.jsonl"),
	});
	return outputDir;
}

async function setRestorePoints(
	dir: string,
	iterations: unknown[],
): Promise<void> {
	const manifestPath = join(dir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	manifest.sessions[0].iterations = iterations;
	await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
}

const checkpoint = {
	ref: "abc123",
	runCount: 1,
	createdAt: 1,
	capture: "iteration-start",
};

describe("sessionReplayIterationRunCounts", () => {
	it("numbers iterations by the span-aware user run they belong to", () => {
		const messages: MessageWithMetadata[] = [
			{
				role: "user",
				content: "Summary of three earlier turns",
				metadata: { kind: "compaction_summary", userRunSpan: 3 },
			},
			{ role: "assistant", content: "Continuing." },
			{ role: "user", content: "Run the tests" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "t1", name: "run_commands", input: {} },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t1",
						name: "run_commands",
						content: "ok",
					},
				],
			},
			{
				role: "user",
				content: "[SYSTEM] Keep going.",
				metadata: { userRunSpan: 0 },
			},
			{ role: "assistant", content: "Tests pass." },
		];
		expect(sessionReplayIterationRunCounts(messages)).toEqual([3, 4, 4]);
		expect(
			buildSessionReplayIterations({
				transcript: { sessionId: "s", messages },
			}),
		).toHaveLength(3);
	});
});

describe("per-iteration restore points", () => {
	it("are optional", async () => {
		const result = await validateSessionReplayBundle(
			await exportBundle("without", { checkpoints: false }),
		);
		expect(result.errors).toEqual([]);
		expect(result.manifest?.sessions[0]).not.toHaveProperty("iterations");
	});

	it("validate and round-trip when present", async () => {
		const dir = await exportBundle("with", { compaction: true });
		const exported = await readSessionReplayBundle(dir);
		expect(exported.manifest.sessions[0]?.iterations).toEqual([
			{
				index: 1,
				checkpoint: {
					ref: "abc123",
					runCount: 1,
					createdAt: Date.parse("2026-01-01T00:00:03.000Z"),
					capture: "iteration-start",
				},
			},
			{
				index: 2,
				checkpoint: {
					ref: "abc123",
					runCount: 1,
					createdAt: Date.parse("2026-01-01T00:00:03.000Z"),
					capture: "run-start",
				},
			},
		]);

		const iterations = [
			{
				index: 1,
				checkpoint: { ...checkpoint, kind: "stash" },
				compaction: { stateId: "prefix-hash-1" },
			},
			{
				index: 2,
				checkpoint: { ...checkpoint, capture: "run-start" },
				compaction: { file: COMPACTION_FILE, stateId: "prefix-hash-2" },
			},
		];
		await setRestorePoints(dir, iterations);
		const result = await validateSessionReplayBundle(dir);
		expect(result.errors).toEqual([]);
		const loaded = await readSessionReplayBundle(dir);
		expect(loaded.manifest.sessions[0]?.iterations).toEqual(iterations);
	});

	it("must point at a compaction file of the same session", async () => {
		const dir = await exportBundle("dangling");
		await setRestorePoints(dir, [
			{ index: 1, compaction: { file: COMPACTION_FILE } },
		]);
		const result = await validateSessionReplayBundle(dir);
		expect(result.errors).toEqual([
			`session ${FIXTURE_SESSION_ID}: iteration 1 points at ${COMPACTION_FILE}, which is not a compaction file of this session`,
		]);
	});

	it("reject unordered indexes and malformed fields", async () => {
		const unordered = await exportBundle("unordered");
		await setRestorePoints(unordered, [
			{ index: 2, checkpoint },
			{ index: 2, checkpoint },
		]);
		const unorderedResult = await validateSessionReplayBundle(unordered);
		expect(unorderedResult.ok).toBe(false);
		expect(unorderedResult.errors.join("\n")).toContain(
			"iteration indexes must be strictly increasing",
		);

		const malformed = await exportBundle("malformed");
		await setRestorePoints(malformed, [
			{ index: 0 },
			{ index: 1, compaction: {} },
			{ index: 2, checkpoint: { ...checkpoint, capture: "later" } },
		]);
		const malformedResult = await validateSessionReplayBundle(malformed);
		expect(malformedResult.ok).toBe(false);
		const errors = malformedResult.errors.join("\n");
		expect(errors).toContain("sessions.0.iterations.0.index");
		expect(errors).toContain("needs a file or a stateId");
		expect(errors).toContain("sessions.0.iterations.2.checkpoint.capture");
	});
});
