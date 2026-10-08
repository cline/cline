import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/core";
import {
	createSessionReplayRedactor,
	type ExportSessionReplayBundleResult,
	validateAtifTrajectory,
	writeSessionReplayBundle,
} from "@cline/session";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	runSessionDiff,
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
			{
				type: "tool_result",
				tool_use_id: "call_1",
				name: "run_commands",
				content: "a.txt\nb.txt",
			},
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

async function writeTestBundle(
	dir: string,
	messages: MessageWithMetadata[] = MESSAGES,
): Promise<void> {
	await writeSessionReplayBundle(dir, {
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
					recording: null,
				},
				transcript: { sessionId: "sess_1", messages },
				events: [],
			},
		],
		redaction: createSessionReplayRedactor({ enabled: true }).report(),
	});
}

beforeEach(async () => {
	mockedExportSessionReplay.mockReset();
	root = await mkdtemp(join(tmpdir(), "cli-session-replay-"));
	bundleDir = join(root, "bundle");
	await writeTestBundle(bundleDir);
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
		manifest.schemaVersion = 3;
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
			"Session replay bundle uses schemaVersion 3, but this version of Cline reads bundles up to schemaVersion 2. Upgrade Cline to read this bundle.",
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
		expect(await run({ mode: "mock" })).toEqual({
			code: 1,
			err: 'Unsupported replay mode "mock". Supported modes: playback, rerun.',
		});
		expect(await run({ rerun: { untilDivergence: true } })).toEqual({
			code: 1,
			err: "--until-divergence needs --mode rerun.",
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

describe("runSessionReplay --mode rerun", () => {
	const rerun = async (
		flags: Record<string, unknown> = {},
		overrides: Record<string, unknown> = {},
	) => {
		const { io, err } = createIo();
		const code = await runSessionReplay({
			bundleDir,
			mode: "rerun",
			format: "json",
			io,
			isInteractiveTTY: false,
			rerun: { out: join(root, "out"), ...flags },
			...overrides,
		});
		return { code, err: err.join("\n") };
	};

	it("rejects flags that do not apply or conflict, with exit 2", async () => {
		expect(await rerun({}, { from: "2", step: true })).toEqual({
			code: 2,
			err: "--from, --step apply to playback only; a rerun always starts from the first iteration.",
		});
		expect(await rerun({ untilDivergence: true, continue: true })).toEqual({
			code: 2,
			err: "--until-divergence and --continue cannot be combined.",
		});
		expect(
			await rerun({ image: "node:22", containerArgs: ["--volume=/a:/a"] }),
		).toEqual({
			code: 2,
			err: "--image, --container-arg need --in-container.",
		});
		expect(
			await rerun(
				{ interactive: true },
				{ format: "tui", isInteractiveTTY: true },
			),
		).toMatchObject({ code: 2, err: expect.stringContaining("--interactive") });
		expect(await rerun({ ignore: "tools" })).toEqual({
			code: 2,
			err: expect.stringContaining(
				'Unknown divergence kind "tools" in --ignore.',
			),
		});
		expect(await rerun({ ignore: "decisions", count: "decisions" })).toEqual({
			code: 2,
			err: "decisions cannot be both ignored (--ignore) and counted (--count).",
		});
	});

	it("starts from the root session only", async () => {
		expect(await rerun({}, { sessionId: "sess_2" })).toEqual({
			code: 2,
			err: "Session sess_2 is not in the bundle. Its root session is sess_1.",
		});
	});

	it("fails clearly when the recorded workspace is not on this machine", async () => {
		const result = await rerun();
		expect(result.code).toBe(2);
		expect(result.err).toContain(
			"The recorded workspace /repo is not on this machine.",
		);
		expect(result.err).toContain("pass --workspace <path>");
	});

	it("refuses to write into a non-empty --out", async () => {
		await mkdir(join(root, "out"));
		await writeFile(join(root, "out", "keep.txt"), "x");
		expect(await rerun()).toEqual({
			code: 2,
			err: `${join(root, "out")} already exists and is not empty; pass --out <dir> to write the rerun elsewhere.`,
		});
	});

	it("needs an image to rerun in a container", async () => {
		expect(await rerun({ inContainer: true })).toEqual({
			code: 2,
			err: "--in-container needs --image <image>: the bundle does not name the image the session ran in (bundles carry no image digest).",
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
			"Valid session replay bundle (schemaVersion 2, 1 session, 3 files)",
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

	it("requires --bundle for bundle exports and rejects --out", async () => {
		const missing = createIo();
		expect(
			await runSessionExport({
				sessionId: "sess_1",
				redact: true,
				overwrite: false,
				outputMode: "text",
				io: missing.io,
			}),
		).toBe(1);
		expect(missing.err).toEqual(["session export requires --bundle <dir>"]);
		const withOut = createIo();
		expect(
			await runSessionExport({
				sessionId: "sess_1",
				bundleDir: "b",
				out: "t.json",
				redact: true,
				overwrite: false,
				outputMode: "text",
				io: withOut.io,
			}),
		).toBe(1);
		expect(withOut.err[0]).toMatch(/--out is only used with --format atif/);
		expect(mockedExportSessionReplay).not.toHaveBeenCalled();
	});
});

describe("runSessionExport --format atif", () => {
	const atif = (
		overrides: Partial<Parameters<typeof runSessionExport>[0]> &
			Pick<Parameters<typeof runSessionExport>[0], "io">,
	) =>
		runSessionExport({
			sessionId: bundleDir,
			format: "atif",
			redact: true,
			overwrite: false,
			outputMode: "text",
			...overrides,
		});

	it("writes a bundle's trajectory to stdout", async () => {
		const { io, out, err } = createIo();
		const stdout = captureStdout();
		let code: number;
		try {
			code = await atif({ io });
		} finally {
			stdout.restore();
		}
		expect(code).toBe(0);
		expect(err).toEqual([]);
		expect(out).toEqual([]);
		const trajectory = JSON.parse(stdout.lines().join("\n"));
		expect(validateAtifTrajectory(trajectory)).toEqual({
			ok: true,
			errors: [],
		});
		expect(trajectory).toMatchObject({
			schema_version: "ATIF-v1.7",
			session_id: "sess_1",
			agent: { name: "cline", version: "0.0.0", model_name: "fake-model" },
			final_metrics: {
				total_prompt_tokens: 230,
				total_completion_tokens: 28,
				total_cost_usd: 0.001,
				total_steps: 3,
			},
		});
		expect(
			trajectory.steps.map((step: { source: string }) => step.source),
		).toEqual(["user", "agent", "agent"]);
		expect(mockedExportSessionReplay).not.toHaveBeenCalled();
	});

	it("writes --out, refuses to replace it without --force and reports JSON", async () => {
		const target = join(root, "out", "trajectory.json");
		const first = createIo();
		expect(await atif({ io: first.io, out: target })).toBe(0);
		expect(first.out).toEqual([
			`Exported session sess_1 as ATIF-v1.7 to ${target}`,
			"  3 steps · 0 subagent trajectories · 230 prompt / 28 completion tokens · $0.0010",
		]);
		expect(
			validateAtifTrajectory(JSON.parse(await readFile(target, "utf8"))).ok,
		).toBe(true);

		const again = createIo();
		expect(await atif({ io: again.io, out: target })).toBe(1);
		expect(again.err).toEqual([
			`${target} already exists; pass --force to replace it`,
		]);

		const forced = createIo();
		const stdout = captureStdout();
		try {
			expect(
				await atif({
					io: forced.io,
					out: target,
					overwrite: true,
					outputMode: "json",
				}),
			).toBe(0);
		} finally {
			stdout.restore();
		}
		expect(JSON.parse(stdout.lines()[0] ?? "")).toMatchObject({
			sessionId: "sess_1",
			format: "atif",
			schemaVersion: "ATIF-v1.7",
			out: target,
			bundleDir,
			steps: 3,
			subagentTrajectories: 0,
			warnings: [],
		});
	});

	it("exports a session id through a temporary bundle with its child sessions", async () => {
		let tempBundle = "";
		mockedExportSessionReplay.mockImplementation(async (input) => {
			tempBundle = input.bundleDir;
			await writeTestBundle(input.bundleDir);
			return {
				warnings: ["No hook audit log was found for this session."],
			} as unknown as ExportSessionReplayBundleResult;
		});
		const target = join(root, "trajectory.json");
		const { io, out, err } = createIo();
		expect(await atif({ io, sessionId: "sess_1", out: target })).toBe(0);
		expect(mockedExportSessionReplay).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "sess_1",
				redact: true,
				includeChildSessions: true,
			}),
		);
		expect(tempBundle).not.toBe("");
		await expect(readFile(join(tempBundle, "manifest.json"))).rejects.toThrow();
		expect(err).toEqual([
			"warning: No hook audit log was found for this session.",
		]);
		expect(out[0]).toBe(`Exported session sess_1 as ATIF-v1.7 to ${target}`);
	});

	it("keeps the intermediate bundle when --bundle is given", async () => {
		const kept = join(root, "kept");
		mockedExportSessionReplay.mockImplementation(async (input) => {
			await writeTestBundle(input.bundleDir);
			return { warnings: [] } as unknown as ExportSessionReplayBundleResult;
		});
		const target = join(root, "trajectory.json");
		const { io, out } = createIo();
		expect(
			await atif({
				io,
				sessionId: "sess_1",
				bundleDir: kept,
				redact: false,
				out: target,
			}),
		).toBe(0);
		expect(mockedExportSessionReplay).toHaveBeenCalledWith(
			expect.objectContaining({ bundleDir: kept, redact: false }),
		);
		expect(out.at(-1)).toBe(`  bundle: ${kept}`);
		await expect(
			readFile(join(kept, "manifest.json"), "utf8"),
		).resolves.toContain("sess_1");
	});

	it("returns 1 for unusable inputs", async () => {
		const plainDir = join(root, "plain");
		await mkdir(plainDir);
		const noManifest = createIo();
		expect(await atif({ io: noManifest.io, sessionId: plainDir })).toBe(1);
		expect(noManifest.err[0]).toMatch(/is a directory without manifest\.json/);

		const bundleAndBundle = createIo();
		expect(
			await atif({ io: bundleAndBundle.io, bundleDir: join(root, "x") }),
		).toBe(1);
		expect(bundleAndBundle.err[0]).toMatch(
			/--bundle writes a new bundle and cannot be used/,
		);

		const empty = createIo();
		expect(await atif({ io: empty.io, sessionId: "  " })).toBe(1);
		expect(empty.err).toEqual([
			"session export requires <session-id> or <bundle>",
		]);

		mockedExportSessionReplay.mockRejectedValue(
			new Error("Session y not found."),
		);
		const failed = createIo();
		expect(await atif({ io: failed.io, sessionId: "y" })).toBe(1);
		expect(failed.err).toEqual(["Session y not found."]);
	});
});

describe("runSessionDiff", () => {
	const changedText = (): MessageWithMetadata[] =>
		MESSAGES.map((message, index) =>
			index === 3
				? { ...message, content: [{ type: "text", text: "Two files: a, b." }] }
				: message,
		);

	it("exits 0 for identical bundles and lists every iteration", async () => {
		const other = join(root, "other");
		await writeTestBundle(other);
		const { io, out, err } = createIo();
		const code = await runSessionDiff({
			recordedDir: bundleDir,
			liveDir: other,
			outputMode: "text",
			io,
		});
		expect(code).toBe(0);
		expect(out).toContain("  iteration 1  same");
		expect(out).toContain("  iteration 2  same");
		expect(out.at(-1)).toBe("Result: no divergence across 2 iterations");
		expect(err).toEqual([
			"warning: request comparison skipped for 2 of 2 iterations: no recorded request on one side (record sessions with --record-session)",
		]);
	});

	it("exits 1 and prints the first divergence when a counted kind differs", async () => {
		const other = join(root, "other");
		await writeTestBundle(other, changedText());
		const { io, out } = createIo();
		const code = await runSessionDiff({
			recordedDir: bundleDir,
			liveDir: other,
			outputMode: "text",
			io,
		});
		expect(code).toBe(1);
		expect(out).toContain("  iteration 2  assistant-text");
		expect(out).toContain(
			"  iteration 2 · assistant-text · assistant text differs at line 1, column 2",
		);
		expect(out.at(-1)).toBe(
			"Result: diverged · 1 counted divergence in 1 iteration",
		);
	});

	it("honours --ignore and --lenient, and emits the report as JSON", async () => {
		const other = join(root, "other");
		await writeTestBundle(other, changedText());
		const ignored = createIo();
		expect(
			await runSessionDiff({
				recordedDir: bundleDir,
				liveDir: other,
				ignore: "assistant-text, request",
				outputMode: "text",
				io: ignored.io,
			}),
		).toBe(0);
		expect(ignored.out).toContain(
			"  counting: all divergence kinds except request-model, request-system-prompt, request-tools, request-messages, assistant-text · strict",
		);
		expect(ignored.out).toContain(
			"  iteration 2  assistant-text (not counted)",
		);

		const lenient = createIo();
		const stdout = captureStdout();
		let code: number;
		try {
			code = await runSessionDiff({
				recordedDir: bundleDir,
				liveDir: other,
				lenient: true,
				outputMode: "json",
				io: lenient.io,
			});
		} finally {
			stdout.restore();
		}
		expect(code).toBe(0);
		const [line] = stdout.lines();
		expect(JSON.parse(line ?? "{}")).toMatchObject({
			recorded: { bundleDir, sessionId: "sess_1" },
			live: { bundleDir: other, sessionId: "sess_1" },
			strictness: "lenient",
			diverged: true,
			failed: false,
			first: { kind: "assistant-text", iteration: 2 },
		});
	});

	it("exits 2 for an unknown kind or an unreadable bundle", async () => {
		const unknown = createIo();
		expect(
			await runSessionDiff({
				recordedDir: bundleDir,
				liveDir: bundleDir,
				ignore: "vibes",
				outputMode: "text",
				io: unknown.io,
			}),
		).toBe(2);
		expect(unknown.err[0]).toContain('Unknown divergence kind "vibes"');

		const missing = createIo();
		expect(
			await runSessionDiff({
				recordedDir: bundleDir,
				liveDir: join(root, "nope"),
				outputMode: "text",
				io: missing.io,
			}),
		).toBe(2);
		expect(missing.err[0]).toContain("Invalid session replay bundle");
	});
});
