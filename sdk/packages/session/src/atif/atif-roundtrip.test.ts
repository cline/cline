import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionCompactionState } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	FIXTURE_CHILD_SESSION_ID,
	FIXTURE_SESSION_ID,
	fixtureChildMessages,
	fixtureChildRecord,
	fixtureRecord,
} from "../bundle.fixtures";
import { exportSessionReplayBundle } from "../bundle-export";
import {
	type LoadedSessionReplayBundle,
	readSessionReplayBundle,
	writeSessionReplayBundle,
} from "../bundle-io";
import { resolveRecordedRequestMessages } from "../recording-messages";
import { FIXTURE_STEPS, recordFixtureSession } from "../replay.fixtures";
import { compareSessionReplaySessions } from "../replay-compare";
import { describeRecordedModelRequest } from "../replay-request";
import { createSessionReplaySource } from "../replay-source";
import { exportSessionReplayBundleToAtif } from "./atif-export";
import { importAtifTrajectoryToBundle } from "./atif-import";
import type { AtifTrajectory } from "./atif-types";
import { validateAtifTrajectory } from "./atif-validate";

const COMPACTION: SessionCompactionState = {
	version: 1,
	updated_at: "2026-01-01T00:00:00.500Z",
	source_message_count: 1,
	source_prefix_hash: "prefix-1",
	messages: [{ role: "user", content: "Summary of the request so far." }],
};

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "atif-roundtrip-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/**
 * A recorded root (decisions, a retried model call, environment facts,
 * checkpoints, per-iteration restore points, compaction) with an unrecorded
 * subagent linked from its second tool call, exported by the real exporter.
 */
async function writeRecordedBundle(): Promise<string> {
	const sessionsDir = join(root, "sessions");
	const recorded = await recordFixtureSession(
		[
			FIXTURE_STEPS[0] ?? { text: "" },
			{ ...(FIXTURE_STEPS[1] ?? { text: "" }), failedAttempts: 1 },
			FIXTURE_STEPS[2] ?? { text: "" },
		],
		{
			sessionId: FIXTURE_SESSION_ID,
			sessionDir: join(sessionsDir, FIXTURE_SESSION_ID),
		},
	);
	const rootMessages = recorded.transcript.messages.map((message) =>
		message.id === "assistant_2"
			? {
					...message,
					childSessions: [
						{
							toolCallId: "call_read",
							sessionId: FIXTURE_CHILD_SESSION_ID,
							kind: "subagent" as const,
						},
					],
				}
			: message,
	);
	const rootRecord = fixtureRecord();
	const child = fixtureChildRecord();
	const exported = join(root, "exported");
	await exportSessionReplayBundle({
		sessionId: FIXTURE_SESSION_ID,
		outputDir: exported,
		sessionsDir,
		globalHookLogPath: join(root, "no-hooks.jsonl"),
		includeChildSessions: true,
		producer: { host: "cli", hostVersion: "3.0.0-test" },
		now: () => new Date("2026-01-01T00:05:00.000Z"),
		source: {
			getSession: async (sessionId) =>
				sessionId === rootRecord.sessionId
					? rootRecord
					: sessionId === child.sessionId
						? child
						: undefined,
			readMessages: async (sessionId) =>
				sessionId === child.sessionId ? fixtureChildMessages() : rootMessages,
			readSessionCompactionState: async (sessionId) =>
				sessionId === FIXTURE_SESSION_ID ? COMPACTION : undefined,
			listChildSessions: async () => [child],
		},
	});

	// Restore points and an environment are not produced by this exporter
	// fixture; write them in so the round trip covers them too.
	const loaded = await readSessionReplayBundle(exported);
	const original = join(root, "original");
	await writeSessionReplayBundle(original, {
		createdAt: loaded.manifest.createdAt,
		producer: loaded.manifest.producer,
		rootSessionId: loaded.manifest.rootSessionId,
		sessions: loaded.sessions.map(
			({ entry: { counts: _counts, ...entry }, blobs, ...session }) => ({
				...session,
				entry:
					entry.sessionId === FIXTURE_SESSION_ID
						? {
								...entry,
								iterations: [
									{
										index: 1,
										checkpoint: {
											ref: "abc123",
											runCount: 1,
											createdAt: 1,
											capture: "iteration-start" as const,
										},
									},
									{
										index: 3,
										compaction: {
											file: `sessions/${FIXTURE_SESSION_ID}/compaction.json`,
											stateId: "prefix-1",
										},
									},
								],
							}
						: entry,
				blobs: [...blobs.values()],
			}),
		),
		redaction: loaded.redaction,
		environment: { image: "node:22", mounts: ["/w"] },
	});
	return original;
}

function rootOf(bundle: LoadedSessionReplayBundle) {
	const session = bundle.sessions.find(
		(candidate) => candidate.entry.sessionId === bundle.manifest.rootSessionId,
	);
	if (!session) throw new Error("no root session");
	return session;
}

async function exportJson(
	dir: string,
	options: Parameters<typeof exportSessionReplayBundleToAtif>[1] = {},
): Promise<AtifTrajectory> {
	const { trajectory } = exportSessionReplayBundleToAtif(
		await readSessionReplayBundle(dir),
		options,
	);
	const json = JSON.parse(JSON.stringify(trajectory)) as AtifTrajectory;
	expect(validateAtifTrajectory(json).errors).toEqual([]);
	return json;
}

describe("bundle -> ATIF -> bundle", () => {
	it("restores every field replay uses from extra.cline", async () => {
		const originalDir = await writeRecordedBundle();
		const original = await readSessionReplayBundle(originalDir);
		const originalRoot = rootOf(original);
		expect(originalRoot.entry.recording?.counts.modelCalls).toBe(4);
		expect(originalRoot.entry.checkpoints).toHaveLength(1);
		expect(originalRoot.entry.iterations).toHaveLength(2);
		expect(originalRoot.compaction).toBeDefined();
		expect(
			originalRoot.events.filter((event) => event.kind === "decision"),
		).not.toHaveLength(0);
		expect(original.redaction.redactions).not.toHaveLength(0);
		expect(original.sessions).toHaveLength(2);

		const trajectory = await exportJson(originalDir);
		const importedDir = join(root, "imported");
		const imported = await importAtifTrajectoryToBundle(
			trajectory,
			importedDir,
		);
		expect(imported.report).toMatchObject({
			restored: "extra.cline",
			rootSessionId: FIXTURE_SESSION_ID,
			unmapped: [],
			warnings: [],
			sessions: [
				{ sessionId: FIXTURE_SESSION_ID, parentSessionId: null },
				{
					sessionId: FIXTURE_CHILD_SESSION_ID,
					parentSessionId: FIXTURE_SESSION_ID,
				},
			],
		});

		// Same manifest, byte for byte, so every indexed file has the same sha256.
		const manifestText = await readFile(
			join(originalDir, "manifest.json"),
			"utf8",
		);
		expect(await readFile(join(importedDir, "manifest.json"), "utf8")).toEqual(
			manifestText,
		);
		for (const file of original.manifest.files) {
			expect(
				await readFile(join(importedDir, file.path), "utf8"),
				file.path,
			).toEqual(await readFile(join(originalDir, file.path), "utf8"));
		}

		const restored = await readSessionReplayBundle(importedDir);
		expect({ ...restored, dir: "" }).toEqual({ ...original, dir: "" });
		const restoredRoot = rootOf(restored);

		// Strict matching serves every recorded request exactly.
		const source = createSessionReplaySource(restoredRoot);
		expect(source.mode).toBe("match-key");
		const resolved = resolveRecordedRequestMessages(
			originalRoot.requests,
		).messages;
		for (const record of originalRoot.requests) {
			const response = source.nextModelResponse({
				request: describeRecordedModelRequest(
					record,
					originalRoot.blobs,
					resolved.get(record.callIndex),
				),
			});
			expect(response).toMatchObject({
				status: "served",
				match: "exact",
				divergences: [],
			});
		}
		expect(source.remaining().modelCalls).toEqual([]);

		const report = compareSessionReplaySessions(originalRoot, restoredRoot);
		expect(report.divergences).toEqual([]);
		expect(report.failed).toBe(false);
	});

	it("rebuilds from the steps when a step no longer matches the embedded data", async () => {
		const originalDir = await writeRecordedBundle();
		const trajectory = await exportJson(originalDir);
		const agent = trajectory.steps.find((step) => step.source === "agent");
		if (!agent) throw new Error("no agent step");
		agent.message = "Edited after export.";
		const importedDir = join(root, "edited");
		const imported = await importAtifTrajectoryToBundle(
			trajectory,
			importedDir,
		);
		expect(imported.report.restored).toBe("steps");
		expect(imported.report.warnings[0]).toMatch(
			/^The extra.cline replay data could not be restored: trajectory sess_fixture: user or agent step 2 differs from its extra.cline.replay data\. The sessions were rebuilt from the steps\.$/,
		);
		const restored = await readSessionReplayBundle(importedDir);
		const restoredRoot = rootOf(restored);
		expect(restoredRoot.entry).toMatchObject({
			source: "atif-import",
			recording: null,
			provider: "openai-compatible",
		});
		expect(restored.sessions.map((session) => session.entry.role)).toEqual([
			"root",
			"subagent",
		]);
		const spawn = restoredRoot.transcript.messages.find((message) =>
			message.childSessions?.some(
				(link) => link.sessionId === FIXTURE_CHILD_SESSION_ID,
			),
		);
		expect(spawn?.childSessions).toEqual([
			{
				toolCallId: "call_read",
				sessionId: FIXTURE_CHILD_SESSION_ID,
				kind: "subagent",
			},
		]);
		expect(createSessionReplaySource(restoredRoot).mode).toBe("call-index");
	});

	it("rebuilds from the steps when the export left the replay data out", async () => {
		const originalDir = await writeRecordedBundle();
		const trajectory = await exportJson(originalDir, {
			includeReplayData: false,
		});
		expect(
			(trajectory.extra?.cline as Record<string, unknown>).replay,
		).toBeUndefined();
		const imported = await importAtifTrajectoryToBundle(
			trajectory,
			join(root, "without-replay"),
		);
		expect(imported.report.restored).toBe("steps");
		expect(imported.report.warnings).toEqual([
			"1 ATIF value(s) could not be carried into the bundle; see the import report.",
		]);
		expect(imported.report.unmapped.map((item) => item.field)).toEqual([
			"agent.tool_definitions",
		]);
		const original = rootOf(await readSessionReplayBundle(originalDir));
		const rebuilt = rootOf(
			await readSessionReplayBundle(join(root, "without-replay")),
		);
		const report = compareSessionReplaySessions(original, rebuilt, {
			kinds: ["assistant-text", "tool-calls", "tool-results"],
		});
		expect(
			report.divergences.filter((divergence) => divergence.counted),
		).toEqual([]);
		expect(report.failed).toBe(false);
	});
});
