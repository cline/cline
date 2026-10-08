import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type MessageWithMetadata,
	redactSensitiveData,
	type SensitiveDataRedaction,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	FIXTURE_CHILD_SESSION_ID,
	FIXTURE_SESSION_ID,
	fixtureHookEntries,
	fixtureMessages,
	fixtureRecord,
	fixtureSource,
	fixtureTreeMessages,
	fixtureTreeSource,
	writeHookLog,
	writeSessionArtifacts,
} from "./bundle.fixtures";
import { exportSessionReplayBundle } from "./bundle-export";
import { readSessionReplayBundle } from "./bundle-io";

let root: string;
let sessionsDir: string;
let globalLogPath: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "replay-export-"));
	sessionsDir = join(root, "sessions");
	globalLogPath = join(root, "hooks", "hooks.jsonl");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function collectRedactions(value: unknown): SensitiveDataRedaction[] {
	const redactions: SensitiveDataRedaction[] = [];
	redactSensitiveData(value, {
		onRedaction: (entry) => redactions.push(entry),
	});
	return redactions;
}

async function exportFixture(options: { redact?: boolean } = {}) {
	const { messagesPath } = await writeSessionArtifacts({
		sessionsDir,
		hookEntries: fixtureHookEntries(),
	});
	const outputDir = join(root, "bundle");
	const result = await exportSessionReplayBundle({
		sessionId: FIXTURE_SESSION_ID,
		outputDir,
		source: fixtureSource({ record: fixtureRecord({ messagesPath }) }),
		sessionsDir,
		globalHookLogPath: globalLogPath,
		redact: options.redact,
		producer: { host: "test", hostVersion: "0.0.0" },
		now: () => new Date("2026-02-01T00:00:00.000Z"),
	});
	return { outputDir, result };
}

describe("exportSessionReplayBundle", () => {
	it("writes a bundle that validates and round-trips", async () => {
		const { outputDir, result } = await exportFixture();
		expect(result.validation.ok).toBe(true);
		expect(result.validation.errors).toEqual([]);

		const { manifest } = result;
		expect(manifest).toMatchObject({
			format: "cline.session-replay-bundle",
			schemaVersion: 2,
			createdAt: "2026-02-01T00:00:00.000Z",
			producer: { name: "@cline/core", host: "test", hostVersion: "0.0.0" },
			rootSessionId: FIXTURE_SESSION_ID,
		});
		const [entry] = manifest.sessions;
		expect(entry).toMatchObject({
			sessionId: FIXTURE_SESSION_ID,
			role: "root",
			parentSessionId: null,
			status: "completed",
			exitCode: 0,
			provider: "openai-compatible",
			model: "fake-model",
			source: "cli",
			team: null,
			eventsSource: "session-log",
			counts: { messages: 4, iterations: 2, events: 3 },
			checkpoints: [{ ref: "abc123", runCount: 1 }],
			iterations: [
				{
					index: 1,
					checkpoint: {
						ref: "abc123",
						runCount: 1,
						capture: "iteration-start",
					},
				},
				{
					index: 2,
					checkpoint: { ref: "abc123", runCount: 1, capture: "run-start" },
				},
			],
		});
		expect(manifest.files.map((file) => [file.kind, file.path])).toEqual([
			["transcript", `sessions/${FIXTURE_SESSION_ID}/transcript.json`],
			["events", `sessions/${FIXTURE_SESSION_ID}/events.jsonl`],
			["redaction-report", "redaction.json"],
		]);

		const loaded = await readSessionReplayBundle(outputDir);
		const [session] = loaded.sessions;
		expect(session?.transcript.systemPrompt).toBe("You are a test agent.");
		expect(session?.transcript.messages).toHaveLength(4);
		expect(
			session?.events.map((event) => [event.name, event.toolCallId]),
		).toEqual([
			["tool_call", "call_1"],
			["tool_result", "call_1"],
			["agent_end", undefined],
		]);
		expect(result.warnings).toEqual([
			"1 hook event(s) from subagents or teammates were not exported; this bundle contains the root session only.",
		]);
	});

	it("redacts VCR-rule matches from the manifest, transcript metadata and events", async () => {
		const { outputDir, result } = await exportFixture();
		const [entry] = result.manifest.sessions;
		expect(entry?.cwd).toBe("/home/REDACTED_USER/project");
		expect(entry?.workspaceRoot).toBe("/home/REDACTED_USER/project");
		expect(entry?.title).toBe("List files in /Users/REDACTED_USER/project");
		expect(entry?.metadata).toEqual({
			apiKey: "REDACTED",
			totalCost: "REDACTED",
			userId: "REDACTED",
		});

		const loaded = await readSessionReplayBundle(outputDir);
		const [session] = loaded.sessions;
		const metadata = session?.transcript.messages.map(
			(message) => message.metadata,
		);
		expect(metadata?.[1]).toEqual({
			requestId: "REDACTED",
			note: "/home/REDACTED_USER/project",
		});
		expect(session?.events[0]?.payload.userId).toBe("REDACTED");
		// Envelope ids used for correlation survive redaction.
		expect(session?.events[0]?.toolCallId).toBe("call_1");

		// Nothing in the covered areas still matches a VCR rule.
		expect(
			collectRedactions(
				loaded.manifest.sessions.map(
					({ metadata, cwd, workspaceRoot, title }) => ({
						metadata,
						cwd,
						workspaceRoot,
						title,
					}),
				),
			),
		).toEqual([]);
		expect(collectRedactions(metadata)).toEqual([]);
		expect(
			collectRedactions(session?.events.map((event) => event.payload)),
		).toEqual([]);

		const raw = await readFile(join(outputDir, "manifest.json"), "utf8");
		expect(raw).not.toContain("sk-live-123");
		expect(raw).not.toContain("/home/alice");

		expect(loaded.redaction.enabled).toBe(true);
		expect(loaded.manifest.redaction.removedCount).toBe(
			loaded.redaction.redactions.length,
		);
		expect(loaded.redaction.redactions).toEqual(
			expect.arrayContaining([
				{
					file: "manifest.json",
					path: "sessions[0].metadata.apiKey",
					rule: "key-exact",
				},
				{
					file: "manifest.json",
					path: "sessions[0].cwd",
					rule: "value:linux-home-path",
				},
				{
					file: `sessions/${FIXTURE_SESSION_ID}/transcript.json`,
					path: "messages[1].metadata.requestId",
					rule: "key-suffix",
				},
			]),
		);
		expect(JSON.stringify(loaded.redaction)).not.toContain("sk-live-123");
	});

	it("keeps everything verbatim when redaction is disabled", async () => {
		const { result } = await exportFixture({ redact: false });
		const [entry] = result.manifest.sessions;
		expect(entry?.cwd).toBe("/home/alice/project");
		expect(entry?.metadata?.apiKey).toBe("sk-live-123");
		expect(result.manifest.redaction).toMatchObject({
			enabled: false,
			removedCount: 0,
		});
	});

	it("maps per-run checkpoints onto the iterations of each run", async () => {
		// Runs 1 and 3 have checkpoints; run 2 (iteration 3) has none.
		const messages: MessageWithMetadata[] = [
			...fixtureMessages(),
			{ id: "m5", role: "user", content: "Now count them" },
			{ id: "m6", role: "assistant", content: "Two." },
			{ id: "m7", role: "user", content: "Thanks" },
			{ id: "m8", role: "assistant", content: "Anytime." },
		];
		const record = fixtureRecord({
			metadata: {
				checkpoint: {
					latest: { ref: "run3", createdAt: 3, runCount: 3, kind: "commit" },
					history: [
						{ ref: "run1-old", createdAt: 1, runCount: 1, kind: "stash" },
						{ ref: "run1", createdAt: 2, runCount: 1, kind: "stash" },
						{ ref: "run3", createdAt: 3, runCount: 3, kind: "commit" },
					],
				},
			},
		});
		const result = await exportSessionReplayBundle({
			sessionId: FIXTURE_SESSION_ID,
			outputDir: join(root, "bundle"),
			source: fixtureSource({ record, messages }),
			sessionsDir,
			globalHookLogPath: globalLogPath,
		});
		expect(result.validation.ok).toBe(true);
		const [entry] = result.manifest.sessions;
		expect(entry?.counts.iterations).toBe(4);
		expect(
			entry?.iterations?.map((point) => [
				point.index,
				point.checkpoint?.ref,
				point.checkpoint?.runCount,
				point.checkpoint?.capture,
			]),
		).toEqual([
			[1, "run1", 1, "iteration-start"],
			[2, "run1", 1, "run-start"],
			[4, "run3", 3, "iteration-start"],
		]);
		expect(entry?.iterations?.every((point) => !point.compaction)).toBe(true);
	});

	it("omits per-iteration restore points when the session has no checkpoints", async () => {
		const result = await exportSessionReplayBundle({
			sessionId: FIXTURE_SESSION_ID,
			outputDir: join(root, "bundle"),
			source: fixtureSource({ record: fixtureRecord({ metadata: {} }) }),
			sessionsDir,
			globalHookLogPath: globalLogPath,
		});
		expect(result.validation.ok).toBe(true);
		expect(result.manifest.sessions[0]?.checkpoints).toEqual([]);
		expect(result.manifest.sessions[0]).not.toHaveProperty("iterations");
	});

	it("falls back to filtering the global hook log", async () => {
		await writeHookLog(globalLogPath, fixtureHookEntries());
		const fallback = await exportSessionReplayBundle({
			sessionId: FIXTURE_SESSION_ID,
			outputDir: join(root, "bundle"),
			source: fixtureSource({}),
			sessionsDir: join(root, "empty-sessions"),
			globalHookLogPath: globalLogPath,
		});
		expect(fallback.manifest.sessions[0]?.eventsSource).toBe("global-log");
		expect(fallback.manifest.sessions[0]?.counts.events).toBe(3);
	});

	it("exports an empty events file when no hook log exists", async () => {
		const result = await exportSessionReplayBundle({
			sessionId: FIXTURE_SESSION_ID,
			outputDir: join(root, "bundle"),
			source: fixtureSource({}),
			sessionsDir: join(root, "empty-sessions"),
			globalHookLogPath: join(root, "missing.jsonl"),
		});
		expect(result.validation.ok).toBe(true);
		expect(result.manifest.sessions[0]?.eventsSource).toBe("none");
		expect(result.warnings).toContain(
			"No hook audit log was found for this session; events.jsonl is empty.",
		);
	});

	it("includes compaction state when the source has it", async () => {
		const outputDir = join(root, "bundle");
		const result = await exportSessionReplayBundle({
			sessionId: FIXTURE_SESSION_ID,
			outputDir,
			source: {
				...fixtureSource({}),
				readSessionCompactionState: async () => ({
					version: 1,
					conversation_id: "conv_1",
					updated_at: "2026-01-01T00:00:04.000Z",
					source_message_count: 4,
					messages: [
						{
							role: "user",
							content: "summary",
							metadata: { orgId: "org_9" },
						},
					],
				}),
			},
			sessionsDir,
			globalHookLogPath: globalLogPath,
		});
		const compactionFile = result.manifest.files.find(
			(file) => file.kind === "compaction",
		);
		expect(compactionFile?.path).toBe(
			`sessions/${FIXTURE_SESSION_ID}/compaction.json`,
		);
		const loaded = await readSessionReplayBundle(outputDir);
		expect(loaded.sessions[0]?.compaction?.messages[0]?.metadata).toEqual({
			orgId: "REDACTED",
		});
	});

	it("adds linked subagent sessions and their hook events when asked", async () => {
		await writeSessionArtifacts({
			sessionsDir,
			messages: fixtureTreeMessages(),
			hookEntries: fixtureHookEntries(),
		});
		const outputDir = join(root, "bundle");
		const result = await exportSessionReplayBundle({
			sessionId: FIXTURE_SESSION_ID,
			outputDir,
			source: fixtureTreeSource(),
			sessionsDir,
			globalHookLogPath: globalLogPath,
			includeChildSessions: true,
		});
		expect(result.warnings).toEqual([]);
		expect(
			result.manifest.sessions.map((session) => [
				session.sessionId,
				session.role,
				session.parentSessionId,
				session.counts.events,
			]),
		).toEqual([
			[FIXTURE_SESSION_ID, "root", null, 3],
			[FIXTURE_CHILD_SESSION_ID, "subagent", FIXTURE_SESSION_ID, 1],
		]);
		const loaded = await readSessionReplayBundle(outputDir);
		expect(
			loaded.sessions[1]?.events.map((event) => [event.name, event.toolCallId]),
		).toEqual([["tool_call", "call_child"]]);
		expect(loaded.sessions[1]?.transcript.messages).toHaveLength(4);
	});

	it("finds unlinked children through the source and reports missing ones", async () => {
		const exportTree = (
			source: ReturnType<typeof fixtureTreeSource>,
			name: string,
		) =>
			exportSessionReplayBundle({
				sessionId: FIXTURE_SESSION_ID,
				outputDir: join(root, name),
				source,
				sessionsDir,
				globalHookLogPath: globalLogPath,
				includeChildSessions: true,
			});
		const listed = await exportTree(
			fixtureTreeSource({ linked: false, listChildren: true }),
			"listed",
		);
		expect(
			listed.manifest.sessions.map((session) => session.sessionId),
		).toEqual([FIXTURE_SESSION_ID, FIXTURE_CHILD_SESSION_ID]);

		const linkedSource = fixtureTreeSource();
		const missing = await exportTree(
			{
				...linkedSource,
				getSession: async (sessionId) =>
					sessionId === FIXTURE_SESSION_ID
						? linkedSource.getSession(sessionId)
						: undefined,
			},
			"missing",
		);
		expect(missing.manifest.sessions).toHaveLength(1);
		expect(missing.warnings).toContain(
			`Linked child session ${FIXTURE_CHILD_SESSION_ID} was not found and is not in the bundle.`,
		);
	});

	it("refuses unknown sessions and non-bundle output directories", async () => {
		await expect(
			exportSessionReplayBundle({
				sessionId: "missing",
				outputDir: join(root, "bundle"),
				source: fixtureSource({}),
				sessionsDir,
			}),
		).rejects.toThrow("Session missing not found.");

		const occupied = join(root, "occupied");
		await mkdir(occupied, { recursive: true });
		await writeFile(join(occupied, "notes.txt"), "keep me", "utf8");
		const exportTo = (overwrite: boolean) =>
			exportSessionReplayBundle({
				sessionId: FIXTURE_SESSION_ID,
				outputDir: occupied,
				source: fixtureSource({}),
				sessionsDir,
				globalHookLogPath: globalLogPath,
				overwrite,
			});
		await expect(exportTo(false)).rejects.toThrow("is not empty");
		await expect(exportTo(true)).rejects.toThrow(
			"does not contain a session replay bundle",
		);
		expect(await readFile(join(occupied, "notes.txt"), "utf8")).toBe("keep me");
	});

	it("overwrites an existing bundle only when asked", async () => {
		const { outputDir } = await exportFixture();
		const again = (overwrite: boolean) =>
			exportSessionReplayBundle({
				sessionId: FIXTURE_SESSION_ID,
				outputDir,
				source: fixtureSource({}),
				sessionsDir,
				globalHookLogPath: globalLogPath,
				overwrite,
			});
		await expect(again(false)).rejects.toThrow("is not empty");
		const result = await again(true);
		expect(result.validation.ok).toBe(true);
	});
});
