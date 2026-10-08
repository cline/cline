import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type LoadedSessionRecording,
	mergeSessionReplayEvents,
	readSessionRecording,
	redactSessionRecording,
} from "./bundle-recording";
import { createSessionReplayRedactor } from "./bundle-redaction";
import type { SessionReplayEvent } from "./bundle-schema";
import type {
	SessionRecordedModelCall,
	SessionRecordingHeader,
} from "./recording-schema";

function event(name: string, ts: string, seq?: number): SessionReplayEvent {
	return {
		index: 99,
		...(seq !== undefined ? { seq } : {}),
		ts,
		kind: seq !== undefined ? "decision" : "hook",
		name,
		sessionId: "sess_1",
		payload: {},
	};
}

const HEADER: SessionRecordingHeader = {
	format: "cline.session-recording",
	version: 1,
	sessionId: "sess_1",
	createdAt: "2026-01-01T00:00:00.000Z",
	segments: [
		{
			startedAt: "2026-01-01T00:00:00.000Z",
			pid: 1,
			leadAgentId: "agent_1",
			initialMessageCount: 0,
			firstSeq: 0,
			mode: "act",
			cwd: "/repo",
			host: { platform: "linux", arch: "x64", node: "v22.0.0" },
			env: { PATH: "/bin", HOME: "/home/u" },
			envSha256: "e".repeat(64),
		},
	],
};

const RECORD: SessionRecordedModelCall = {
	callIndex: 0,
	seq: 3,
	sessionId: "sess_1",
	agentId: "agent_1",
	runId: "run_1",
	iteration: 1,
	attempt: 0,
	startedAt: "2026-01-01T00:00:00.000Z",
	finishedAt: "2026-01-01T00:00:01.000Z",
	durationMs: 1000,
	compaction: null,
	request: {
		matchKey: "a".repeat(64),
		systemPromptSha256: null,
		toolsSha256: "b".repeat(64),
		modelToolsSha256: null,
		messageCount: 1,
		messagePrefix: null,
		messageSha256s: ["c".repeat(64)],
		options: {
			metadata: { runId: "run_1" },
			apiKey: "sk-ant-api03-recording-secret-value-1234567890",
		},
		provider: { provider: "anthropic", model: "claude", baseUrl: "https://x" },
	},
	response: {
		outcome: "completed",
		finishReason: "stop",
		requestId: null,
		error: null,
		messageId: "msg_1",
		toolCallIds: [],
		usage: { inputTokens: 10, outputTokens: 2, totalCost: 0.01 },
		events: [
			{ t: 1, event: { type: "text-delta", text: "Hi there" } },
			{
				t: 2,
				event: { type: "usage", usage: { inputTokens: 10, totalCost: 0.01 } },
			},
		],
	},
};

describe("mergeSessionReplayEvents", () => {
	it("keeps recorded events in seq order and places unsequenced ones by time", () => {
		const merged = mergeSessionReplayEvents(
			[
				event("agent_start", "2026-01-01T00:00:00.000Z"),
				event("agent_end", "2026-01-01T00:00:09.000Z"),
			],
			[
				// Out of timestamp order (clock skew): seq still wins.
				event("approval_resolved", "2026-01-01T00:00:02.000Z", 2),
				event("approval_requested", "2026-01-01T00:00:03.000Z", 1),
			],
		);
		expect(merged.map((entry) => [entry.index, entry.name])).toEqual([
			[0, "agent_start"],
			[1, "approval_requested"],
			[2, "approval_resolved"],
			[3, "agent_end"],
		]);
	});
});

describe("readSessionRecording", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "bundle-recording-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("returns undefined for unrecorded sessions", async () => {
		expect(await readSessionRecording(root)).toBeUndefined();
	});

	it("reads records in call order and counts torn lines", async () => {
		const dir = join(root, "recording");
		mkdirSync(dir);
		writeFileSync(join(dir, "recording.json"), JSON.stringify(HEADER));
		writeFileSync(
			join(dir, "requests.jsonl"),
			[
				JSON.stringify({ ...RECORD, callIndex: 1, seq: 9 }),
				JSON.stringify(RECORD),
				'{"callIndex":2,"seq"',
			].join("\n"),
		);
		const recording = await readSessionRecording(root);
		expect(recording?.requests.map((record) => record.callIndex)).toEqual([
			0, 1,
		]);
		expect(recording?.skippedLines).toBe(1);
		expect(recording?.blobs).toEqual([]);
	});
});

describe("redactSessionRecording", () => {
	const recording: LoadedSessionRecording = {
		header: HEADER,
		requests: [RECORD],
		blobs: [
			{
				sha256: "c".repeat(64),
				kind: "message",
				value: {
					role: "user",
					content: [{ type: "text", text: "keep me" }],
					metadata: { requestId: "req_secret", note: "kept" },
				},
			},
			{ sha256: "d".repeat(64), kind: "system-prompt", value: "System." },
		],
		events: [],
		skippedLines: 0,
	};

	const redact = (enabled: boolean) => {
		const redactor = createSessionReplayRedactor({ enabled, recorded: true });
		const result = redactSessionRecording({
			recording,
			redactor,
			requestsFile: "sessions/sess_1/requests/requests.jsonl",
			blobsFile: "sessions/sess_1/requests/blobs.jsonl",
			manifestFile: "manifest.json",
		});
		return { result, report: redactor.report() };
	};

	it("redacts options, usage and message metadata but keeps the conversation", () => {
		const { result, report } = redact(true);
		const [record] = result.requests;
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("recording-secret");
		expect(serialized).not.toContain("req_secret");
		expect(record?.response.usage).not.toHaveProperty("totalCost", 0.01);
		expect(record?.response.usage).toMatchObject({ inputTokens: 10 });
		expect(record?.request.provider).toMatchObject({
			provider: "anthropic",
			model: "claude",
		});
		expect(record?.response.events[0]).toEqual(RECORD.response.events[0]);
		expect(record?.response.events[1]?.event).not.toHaveProperty(
			"usage.totalCost",
			0.01,
		);
		const [message, prompt] = result.blobs;
		expect(message?.redacted).toBe(true);
		expect(message?.value).toMatchObject({
			content: [{ type: "text", text: "keep me" }],
			metadata: { note: "kept" },
		});
		expect(prompt).toEqual(recording.blobs[1]);
		expect(result.segments[0]?.env).toMatchObject({ PATH: "/bin" });
		expect(
			report.redactions.some(
				(entry) =>
					entry.file === "sessions/sess_1/requests/requests.jsonl" &&
					entry.path.startsWith("[0].request.options"),
			),
		).toBe(true);
		expect(report.covered.join("\n")).toContain("requests/requests.jsonl");
	});

	it("leaves everything verbatim when redaction is off", () => {
		const { result, report } = redact(false);
		expect(result.requests).toEqual(recording.requests);
		expect(result.blobs).toEqual(recording.blobs);
		expect(report.redactions).toEqual([]);
	});
});
