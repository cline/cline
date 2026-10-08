import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureMessages } from "./bundle.fixtures";
import {
	readSessionReplayBundle,
	type SessionReplayBundleSessionInput,
	validateSessionReplayBundle,
	writeSessionReplayBundle,
} from "./bundle-io";
import { createSessionReplayRedactor } from "./bundle-redaction";
import type {
	SessionReplayIterationRestorePoint,
	SessionReplaySessionEntry,
} from "./bundle-schema";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "replay-restore-points-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function sessionInput(
	overrides: Partial<Omit<SessionReplaySessionEntry, "counts">> = {},
): SessionReplayBundleSessionInput {
	const entry: Omit<SessionReplaySessionEntry, "counts"> = {
		sessionId: "root",
		role: "root",
		parentSessionId: null,
		agentId: null,
		parentAgentId: null,
		conversationId: null,
		source: "cli",
		status: "completed",
		exitCode: 0,
		startedAt: "2026-01-01T00:00:00.000Z",
		endedAt: "2026-01-01T00:00:04.000Z",
		interactive: false,
		provider: "openai-compatible",
		model: "fake-model",
		cwd: "/repo",
		workspaceRoot: "/repo",
		team: null,
		checkpoints: [],
		eventsSource: "none",
		...overrides,
	};
	return {
		entry,
		transcript: { sessionId: entry.sessionId, messages: fixtureMessages() },
		events: [],
	};
}

async function writeBundle(name: string, input = sessionInput()) {
	const dir = join(root, name);
	await writeSessionReplayBundle(dir, {
		createdAt: "2026-02-01T00:00:00.000Z",
		producer: { name: "@cline/core", version: "0.0.0" },
		rootSessionId: "root",
		sessions: [input],
		redaction: createSessionReplayRedactor({ enabled: true }).report(),
	});
	return dir;
}

async function validateEditedRestorePoints(
	name: string,
	iterations: unknown[],
): Promise<string> {
	const dir = await writeBundle(name);
	const manifestPath = join(dir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	manifest.sessions[0].iterations = iterations;
	await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
	const result = await validateSessionReplayBundle(dir);
	expect(result.ok).toBe(false);
	return result.errors.join("\n");
}

const checkpoint = {
	ref: "abc123",
	runCount: 1,
	createdAt: 1,
	capture: "iteration-start" as const,
};

describe("per-iteration restore points", () => {
	it("are optional", async () => {
		const result = await validateSessionReplayBundle(
			await writeBundle("without"),
		);
		expect(result.errors).toEqual([]);
		expect(result.manifest?.sessions[0]).not.toHaveProperty("iterations");
	});

	it("validate and round-trip when present", async () => {
		const iterations: SessionReplayIterationRestorePoint[] = [
			{
				index: 1,
				checkpoint: { ...checkpoint, kind: "stash" },
				compaction: { stateId: "prefix-hash-1" },
			},
			{
				index: 2,
				checkpoint: { ...checkpoint, capture: "run-start" },
				compaction: {
					file: "sessions/root/compaction.json",
					stateId: "prefix-hash-2",
				},
			},
		];
		const input = sessionInput({ iterations });
		input.compaction = {
			version: 1,
			updated_at: "2026-01-01T00:00:03.000Z",
			source_message_count: 2,
			messages: [{ role: "user", content: "summary" }],
		};
		const dir = await writeBundle("with", input);
		const result = await validateSessionReplayBundle(dir);
		expect(result.errors).toEqual([]);
		const loaded = await readSessionReplayBundle(dir);
		expect(loaded.manifest.sessions[0]?.iterations).toEqual(iterations);
	});

	it("must point at a compaction file of the same session", async () => {
		const dir = await writeBundle(
			"dangling",
			sessionInput({
				iterations: [
					{
						index: 1,
						compaction: { file: "sessions/root/compaction.json" },
					},
				],
			}),
		);
		const result = await validateSessionReplayBundle(dir);
		expect(result.errors).toEqual([
			"session root: iteration 1 points at sessions/root/compaction.json, which is not a compaction file of this session",
		]);
	});

	it("reject unordered indexes and malformed fields", async () => {
		expect(
			await validateEditedRestorePoints("unordered", [
				{ index: 2, checkpoint },
				{ index: 2, checkpoint },
			]),
		).toContain("iteration indexes must be strictly increasing");
		const fieldErrors = await validateEditedRestorePoints("fields", [
			{ index: 0 },
			{ index: 1, compaction: {} },
			{ index: 2, checkpoint: { ...checkpoint, capture: "later" } },
		]);
		expect(fieldErrors).toContain("sessions.0.iterations.0.index");
		expect(fieldErrors).toContain("needs a file or a stateId");
		expect(fieldErrors).toContain("sessions.0.iterations.2.checkpoint.capture");
	});
});
