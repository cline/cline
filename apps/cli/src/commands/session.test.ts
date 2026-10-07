import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createSessionReplayRedactor,
	type ExportSessionReplayBundleResult,
	type MessageWithMetadata,
	writeSessionReplayBundle,
} from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	runSessionExport,
	runSessionReplay,
	runSessionValidate,
} from "./session";

vi.mock("../session/session", () => ({
	exportSessionReplay: vi.fn(),
}));

import { exportSessionReplay } from "../session/session";

const mockedExportSessionReplay = vi.mocked(exportSessionReplay);

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

const MESSAGES: MessageWithMetadata[] = [
	{ role: "user", content: "List the files", ts: T0 },
	{
		role: "assistant",
		content: [
			{ type: "text", text: "Running ls." },
			{
				type: "tool_use",
				id: "call_1",
				name: "run_commands",
				input: { commands: ["ls"] },
			},
		],
		ts: T0 + 1_000,
		metrics: { inputTokens: 100, outputTokens: 20, cost: 0.001 },
		modelInfo: { id: "fake-model", provider: "openai-compatible" },
	},
	{
		role: "user",
		content: [
			{ type: "tool_result", tool_use_id: "call_1", content: "a.txt\nb.txt" },
		],
		ts: T0 + 1_500,
	},
	{
		role: "assistant",
		content: [{ type: "text", text: "There are two files." }],
		ts: T0 + 5_500,
		metrics: { inputTokens: 130, outputTokens: 8 },
	},
];

let root: string;
let bundleDir: string;

function createIo() {
	const out: string[] = [];
	const err: string[] = [];
	return {
		out,
		err,
		io: {
			writeln: (text = "") => out.push(text),
			writeErr: (text: string) => err.push(text),
		},
	};
}

function captureStdout(): { lines: () => string[]; restore: () => void } {
	const chunks: string[] = [];
	const spy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: string | Uint8Array) => {
			chunks.push(String(chunk));
			return true;
		});
	return {
		lines: () => chunks.join("").split("\n").filter(Boolean),
		restore: () => spy.mockRestore(),
	};
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "cli-session-replay-"));
	bundleDir = join(root, "bundle");
	await writeSessionReplayBundle(bundleDir, {
		createdAt: "2026-02-01T00:00:00.000Z",
		producer: { name: "@cline/core", version: "0.0.0" },
		rootSessionId: "sess_1",
		sessions: [
			{
				entry: {
					sessionId: "sess_1",
					role: "root",
					parentSessionId: null,
					agentId: null,
					parentAgentId: null,
					conversationId: null,
					source: "cli",
					status: "completed",
					exitCode: 0,
					startedAt: "2026-01-01T00:00:00.000Z",
					endedAt: "2026-01-01T00:00:06.000Z",
					interactive: false,
					provider: "openai-compatible",
					model: "fake-model",
					cwd: "/repo",
					workspaceRoot: "/repo",
					team: null,
					checkpoints: [],
					eventsSource: "none",
				},
				transcript: { sessionId: "sess_1", messages: MESSAGES },
				events: [],
			},
		],
		redaction: createSessionReplayRedactor({ enabled: true }).report(),
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(root, { recursive: true, force: true });
});

describe("runSessionReplay", () => {
	it("emits one JSON object per iteration", async () => {
		const { io, err } = createIo();
		const stdout = captureStdout();
		try {
			const code = await runSessionReplay({
				bundleDir,
				format: "json",
				io,
				isInteractiveTTY: false,
			});
			expect(code).toBe(0);
		} finally {
			stdout.restore();
		}
		expect(err).toEqual([]);
		const records = stdout.lines().map((line) => JSON.parse(line));
		expect(records.map((record) => record.index)).toEqual([1, 2]);
		expect(records[0]).toMatchObject({
			sessionId: "sess_1",
			turn: 1,
			prompt: { text: "List the files" },
			assistant: { text: "Running ls." },
			toolCalls: [
				{
					id: "call_1",
					name: "run_commands",
					result: { text: "a.txt\nb.txt" },
				},
			],
			usage: { inputTokens: 100, outputTokens: 20, cost: 0.001 },
		});
		expect(records[1].timing.sincePreviousMs).toBe(4_000);
	});

	it("applies --from/--to", async () => {
		const { io } = createIo();
		const stdout = captureStdout();
		try {
			await runSessionReplay({
				bundleDir,
				format: "json",
				from: "2",
				to: "2",
				io,
				isInteractiveTTY: false,
			});
		} finally {
			stdout.restore();
		}
		expect(stdout.lines().map((line) => JSON.parse(line).index)).toEqual([2]);
	});

	it("renders text turn by turn and defaults to text without a TTY", async () => {
		const { io, out } = createIo();
		const sleep = vi.fn(async () => {});
		const code = await runSessionReplay({
			bundleDir,
			io,
			isInteractiveTTY: false,
			sleep,
		});
		expect(code).toBe(0);
		expect(sleep).not.toHaveBeenCalled();
		const text = out.join("\n");
		expect(text).toContain("Session replay sess_1");
		expect(text).toContain("── Iteration 1/2 · turn 1 · 1.5s ──");
		expect(text).toContain("❯ List the files");
		expect(text).toContain("tool run_commands call_1 · ok");
		expect(text).toContain('      input:  {"commands":["ls"]}');
		expect(text).toContain("      result: a.txt\n              b.txt");
		expect(text).toContain(
			"usage: 100 in · 20 out · $0.001000 · fake-model (openai-compatible)",
		);
		expect(text).toContain(
			"── Iteration 2/2 · turn 1 · 0ms · +4.0s after previous ──",
		);
		expect(text).toContain(
			"── End of replay · 2 iterations · 1 tool call · 230 in / 28 out",
		);
	});

	it("waits recorded gaps scaled by --speed", async () => {
		const { io } = createIo();
		const sleep = vi.fn(async () => {});
		await runSessionReplay({
			bundleDir,
			format: "text",
			speed: "2",
			io,
			isInteractiveTTY: false,
			sleep,
		});
		expect(sleep).toHaveBeenCalledExactlyOnceWith(2_000);
	});

	it("stops step-through playback when the user quits", async () => {
		const { io, out } = createIo();
		const waitForStep = vi.fn(async () => false);
		const code = await runSessionReplay({
			bundleDir,
			format: "text",
			step: true,
			io,
			isInteractiveTTY: false,
			waitForStep,
		});
		expect(code).toBe(0);
		expect(waitForStep).toHaveBeenCalledOnce();
		expect(out.join("\n")).not.toContain("Iteration 2/2");
	});

	it("refuses bundles with a newer schemaVersion", async () => {
		const manifestPath = join(bundleDir, "manifest.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
		manifest.schemaVersion = 2;
		await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
		const { io, err } = createIo();
		const code = await runSessionReplay({
			bundleDir,
			format: "text",
			io,
			isInteractiveTTY: false,
		});
		expect(code).toBe(1);
		expect(err).toEqual([
			"Session replay bundle uses schemaVersion 2, but this version of Cline reads bundles up to schemaVersion 1. Upgrade Cline to read this bundle.",
		]);
	});

	it("rejects bad options", async () => {
		const run = async (overrides: Record<string, unknown>) => {
			const { io, err } = createIo();
			const code = await runSessionReplay({
				bundleDir,
				io,
				isInteractiveTTY: false,
				...overrides,
			});
			return { code, err: err.join("\n") };
		};
		expect(await run({ mode: "rerun" })).toEqual({
			code: 1,
			err: 'Unsupported replay mode "rerun". Supported modes: playback.',
		});
		expect(await run({ format: "tui" })).toMatchObject({ code: 1 });
		expect(await run({ from: "0" })).toEqual({
			code: 1,
			err: '--from must be an integer >= 1, got "0"',
		});
		expect(await run({ from: "3" })).toEqual({
			code: 1,
			err: "--from (3) is past the last iteration; the session has 2 iterations",
		});
		expect(await run({ speed: "-1" })).toMatchObject({ code: 1 });
		expect(await run({ sessionId: "nope" })).toEqual({
			code: 1,
			err: "Session nope is not in this bundle (available: sess_1).",
		});
	});
});

describe("runSessionValidate", () => {
	it("reports valid and tampered bundles", async () => {
		const valid = createIo();
		expect(
			await runSessionValidate({ bundleDir, outputMode: "text", io: valid.io }),
		).toBe(0);
		expect(valid.out).toEqual([
			"Valid session replay bundle (schemaVersion 1, 1 session, 3 files)",
		]);

		await writeFile(
			join(bundleDir, "sessions", "sess_1", "events.jsonl"),
			"{}\n",
		);
		const invalid = createIo();
		expect(
			await runSessionValidate({
				bundleDir,
				outputMode: "text",
				io: invalid.io,
			}),
		).toBe(1);
		expect(invalid.err[0]).toContain("Invalid session replay bundle");
		expect(invalid.err).toContain(
			"  - files: sessions/sess_1/events.jsonl size does not match the manifest",
		);
	});
});

describe("runSessionExport", () => {
	it("exports through the CLI core and reports warnings", async () => {
		mockedExportSessionReplay.mockResolvedValue({
			outputDir: bundleDir,
			manifest: {
				schemaVersion: 1,
				sessions: [
					{
						counts: { messages: 4, iterations: 2, events: 0 },
						eventsSource: "none",
					},
				],
				files: [{ path: "manifest.json" }],
				redaction: { enabled: true, removedCount: 3, report: "redaction.json" },
			},
			validation: { ok: true, errors: [], warnings: [] },
			warnings: [
				"No hook audit log was found for this session; events.jsonl is empty.",
			],
		} as unknown as ExportSessionReplayBundleResult);
		const { io, out, err } = createIo();
		const code = await runSessionExport({
			sessionId: " sess_1 ",
			bundleDir: "out/bundle",
			redact: true,
			overwrite: false,
			outputMode: "text",
			io,
		});
		expect(code).toBe(0);
		expect(mockedExportSessionReplay).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "sess_1",
				bundleDir: join(process.cwd(), "out/bundle"),
				redact: true,
				overwrite: false,
			}),
		);
		expect(out).toEqual([
			`Exported session sess_1 to ${join(process.cwd(), "out/bundle")}`,
			"  2 iterations · 4 messages · 0 events (none)",
			"  redaction: on, 3 values removed (see redaction.json)",
		]);
		expect(err).toEqual([
			"warning: No hook audit log was found for this session; events.jsonl is empty.",
		]);
	});

	it("returns 1 with the error message when export fails", async () => {
		mockedExportSessionReplay.mockRejectedValue(
			new Error("Session x not found."),
		);
		const { io, err } = createIo();
		const code = await runSessionExport({
			sessionId: "x",
			bundleDir: "b",
			redact: true,
			overwrite: false,
			outputMode: "text",
			io,
		});
		expect(code).toBe(1);
		expect(err).toEqual(["Session x not found."]);
	});
});
