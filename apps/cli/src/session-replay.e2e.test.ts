import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cliRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(cliRoot, "src", "index.ts");
const bunExec = process.env.BUN_EXEC_PATH ?? "bun";

interface CliRun {
	status: number | null;
	stdout: string;
	stderr: string;
}

// Async so the in-process fake model server keeps serving while the CLI runs.
function runCli(
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<CliRun> {
	return new Promise((resolve, reject) => {
		const child = spawn(bunExec, [cliEntry, ...args], {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(
				new Error(
					`cline ${args.join(" ")} timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`,
				),
			);
		}, options.timeoutMs ?? 60_000);
		child.on("error", reject);
		child.on("close", (status) => {
			clearTimeout(timer);
			resolve({ status, stdout, stderr });
		});
	});
}

function sseChunk(
	delta: unknown,
	finishReason: string | null,
	usage?: unknown,
) {
	return `data: ${JSON.stringify({
		id: "chatcmpl-fake",
		object: "chat.completion.chunk",
		created: 0,
		model: "fake-model",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
		...(usage ? { usage } : {}),
	})}\n\n`;
}

function toolCallChunk(id: string, name: string, input: unknown) {
	return sseChunk(
		{
			tool_calls: [
				{
					index: 0,
					id,
					type: "function",
					function: { name, arguments: JSON.stringify(input) },
				},
			],
		},
		null,
	);
}

/**
 * `recorded`: run a shell command, then submit. `diverge`: run a second,
 * different command before submitting, so a rerun diverges at iteration 2.
 */
let fakeModelScript: "recorded" | "diverge" = "recorded";

/**
 * OpenAI-compatible streaming endpoint scripted for a two-iteration session:
 * run a shell command, then submit once the tool result is in the history.
 */
function startFakeModel(): Promise<Server> {
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			const messages =
				(JSON.parse(body || "{}") as { messages?: Array<{ role?: string }> })
					.messages ?? [];
			const toolResults = messages.filter(
				(message) => message.role === "tool",
			).length;
			res.writeHead(200, { "content-type": "text/event-stream" });
			if (fakeModelScript === "diverge" && toolResults === 1) {
				res.write(
					sseChunk({ role: "assistant", content: "Running echo again." }, null),
				);
				res.write(
					toolCallChunk("call_diverged", "run_commands", {
						commands: ["echo replay-diverged"],
					}),
				);
				res.write(
					sseChunk({}, "tool_calls", {
						prompt_tokens: 140,
						completion_tokens: 12,
						total_tokens: 152,
					}),
				);
			} else if (toolResults > 0) {
				res.write(
					sseChunk(
						{ role: "assistant", content: "The command printed replay-e2e." },
						null,
					),
				);
				res.write(
					toolCallChunk("call_submit", "submit_and_exit", {
						summary: "Ran the echo command and read its output.",
						verified: true,
					}),
				);
				res.write(
					sseChunk({}, "tool_calls", {
						prompt_tokens: 160,
						completion_tokens: 9,
						total_tokens: 169,
					}),
				);
			} else {
				res.write(
					sseChunk({ role: "assistant", content: "Running echo." }, null),
				);
				res.write(
					toolCallChunk("call_echo", "run_commands", {
						commands: ["echo replay-e2e"],
					}),
				);
				res.write(
					sseChunk({}, "tool_calls", {
						prompt_tokens: 120,
						completion_tokens: 15,
						total_tokens: 135,
					}),
				);
			}
			res.end("data: [DONE]\n\n");
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

describe("session replay e2e", () => {
	let server: Server;
	let root: string;
	let env: NodeJS.ProcessEnv;
	let workspace: string;

	beforeAll(async () => {
		server = await startFakeModel();
		const { port } = server.address() as AddressInfo;
		root = mkdtempSync(path.join(os.tmpdir(), "cli-replay-e2e-"));
		const home = path.join(root, "home");
		const data = path.join(root, "data");
		workspace = path.join(root, "workspace");
		for (const dir of [home, data, workspace]) {
			mkdirSync(dir, { recursive: true });
		}
		const providersPath = path.join(data, "settings", "providers.json");
		mkdirSync(path.dirname(providersPath), { recursive: true });
		writeFileSync(
			providersPath,
			JSON.stringify({
				version: 1,
				lastUsedProvider: "openai-compatible",
				modes: {},
				providers: {
					"openai-compatible": {
						settings: {
							provider: "openai-compatible",
							apiKey: "sk-replay-e2e",
							model: "fake-model",
							baseUrl: `http://127.0.0.1:${port}/v1`,
						},
						updatedAt: new Date().toISOString(),
						tokenSource: "manual",
					},
				},
			}),
		);
		env = {
			...process.env,
			HOME: home,
			CLINE_DIR: path.join(home, ".cline"),
			CLINE_DATA_DIR: data,
			CLINE_DB_DATA_DIR: path.join(data, "db"),
			CLINE_SESSION_DATA_DIR: path.join(root, "sessions"),
			CLINE_TEAM_DATA_DIR: path.join(root, "teams"),
			CLINE_SESSION_BACKEND_MODE: "local",
			CLINE_PROVIDER_SETTINGS_PATH: providersPath,
			CLINE_HOOKS_LOG_PATH: path.join(data, "logs", "hooks.jsonl"),
			NO_COLOR: "1",
		};
	});

	afterAll(async () => {
		await new Promise((resolve) => server?.close(resolve));
		if (root) {
			await removeWhenSettled(root);
		}
	}, 30_000);

	it("records a session, exports it, and plays it back", async () => {
		const run = await runCli(["-y", "Run echo for me"], {
			cwd: workspace,
			env,
		});
		expect(run.status, run.stderr).toBe(0);
		expect(run.stdout).toContain("replay-e2e");

		const history = await runCli(["history", "--json"], {
			cwd: workspace,
			env,
		});
		expect(history.status, history.stderr).toBe(0);
		const sessions = JSON.parse(history.stdout) as Array<{ sessionId: string }>;
		expect(sessions).toHaveLength(1);
		const sessionId = sessions[0]?.sessionId ?? "";
		expect(
			existsSync(
				path.join(root, "sessions", sessionId, `${sessionId}.hooks.jsonl`),
			),
		).toBe(true);

		const bundleDir = path.join(root, "bundle");
		const exported = await runCli(
			["session", "export", sessionId, "--bundle", bundleDir, "--json"],
			{ cwd: workspace, env },
		);
		expect(exported.status, exported.stderr).toBe(0);
		expect(JSON.parse(exported.stdout)).toMatchObject({
			sessionId,
			schemaVersion: 2,
			counts: { iterations: 2 },
			eventsSource: "session-log",
			recording: null,
			redaction: { enabled: true },
		});
		expect(
			existsSync(path.join(root, "sessions", sessionId, "recording")),
		).toBe(false);

		const validated = await runCli(["session", "validate", bundleDir], {
			cwd: workspace,
			env,
		});
		expect(validated.status, validated.stderr).toBe(0);
		expect(validated.stdout).toContain("Valid session replay bundle");

		const json = await runCli(
			["session", "replay", bundleDir, "--format", "json"],
			{ cwd: workspace, env },
		);
		expect(json.status, json.stderr).toBe(0);
		const iterations = json.stdout
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(iterations.map((iteration) => iteration.index)).toEqual([1, 2]);
		expect(iterations[0]).toMatchObject({
			turn: 1,
			prompt: { text: "Run echo for me" },
			assistant: { text: "Running echo." },
			toolCalls: [{ id: "call_echo", name: "run_commands" }],
			usage: { inputTokens: 120, outputTokens: 15 },
		});
		expect(iterations[0].toolCalls[0].result.text).toContain("replay-e2e");
		expect(iterations[1].toolCalls[0].name).toBe("submit_and_exit");

		const text = await runCli(["session", "replay", bundleDir], {
			cwd: workspace,
			env,
		});
		expect(text.status, text.stderr).toBe(0);
		expect(text.stdout).toContain("── Iteration 1/2 · turn 1");
		expect(text.stdout).toContain("❯ Run echo for me");
		expect(text.stdout).toContain("tool run_commands call_echo · ok");
		expect(text.stdout).toContain("── Iteration 2/2");
		expect(text.stdout).toContain("── End of replay · 2 iterations");

		const manifestPath = path.join(bundleDir, "manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		manifest.schemaVersion = 99;
		writeFileSync(manifestPath, JSON.stringify(manifest));
		const refused = await runCli(["session", "replay", bundleDir], {
			cwd: workspace,
			env,
		});
		expect(refused.status).toBe(1);
		expect(refused.stderr).toContain(
			"Session replay bundle uses schemaVersion 99, but this version of Cline reads bundles up to schemaVersion 2.",
		);
	}, 180_000);

	/**
	 * Env for a run against its own hub: a separate data dir (so hub discovery
	 * starts empty), sessions dir, database and port. No backend mode is set, as
	 * for a user who has not chosen one.
	 */
	async function hubTestEnv(name: string): Promise<{
		env: NodeJS.ProcessEnv;
		dataDir: string;
		sessionsDir: string;
	}> {
		const dataDir = path.join(root, `${name}-data`);
		const sessionsDir = path.join(root, `${name}-sessions`);
		const hubEnv: NodeJS.ProcessEnv = {
			...env,
			CLINE_DATA_DIR: dataDir,
			CLINE_DB_DATA_DIR: path.join(dataDir, "db"),
			CLINE_SESSION_DATA_DIR: sessionsDir,
			CLINE_HOOKS_LOG_PATH: path.join(dataDir, "logs", "hooks.jsonl"),
			CLINE_HUB_PORT: String(await findFreePort()),
		};
		delete hubEnv.CLINE_SESSION_BACKEND_MODE;
		return { env: hubEnv, dataDir, sessionsDir };
	}

	async function onlySessionId(hubEnv: NodeJS.ProcessEnv): Promise<string> {
		const history = await runCli(["history", "--json"], {
			cwd: workspace,
			env: hubEnv,
		});
		expect(history.status, history.stderr).toBe(0);
		const sessions = JSON.parse(history.stdout) as Array<{
			sessionId: string;
		}>;
		expect(sessions).toHaveLength(1);
		return sessions[0]?.sessionId ?? "";
	}

	it("starts the hub for --record-session when none is running, and the hub records the session", async () => {
		const { env: hubEnv, dataDir, sessionsDir } = await hubTestEnv("no-hub");
		expect(readHubDiscovery(dataDir)).toBeUndefined();
		try {
			// Yolo runs locally unless the session is recorded.
			const run = await runCli(["-y", "--record-session", "Run echo for me"], {
				cwd: workspace,
				env: hubEnv,
				timeoutMs: 120_000,
			});
			expect(run.status, run.stderr).toBe(0);
			expect(run.stdout).toContain("replay-e2e");
			const hub = readHubDiscovery(dataDir);
			expect(hub?.pid).toBeDefined();

			const sessionId = await onlySessionId(hubEnv);
			const recordingDir = path.join(sessionsDir, sessionId, "recording");
			const header = JSON.parse(
				readFileSync(path.join(recordingDir, "recording.json"), "utf8"),
			) as { segments: Array<{ pid: number }> };
			expect(header.segments.map((segment) => segment.pid)).toEqual([hub?.pid]);

			const bundleDir = path.join(root, "no-hub-bundle");
			const exported = await runCli(
				["session", "export", sessionId, "--bundle", bundleDir, "--json"],
				{ cwd: workspace, env: hubEnv },
			);
			expect(exported.status, exported.stderr).toBe(0);
			const summary = JSON.parse(exported.stdout);
			expect(summary).toMatchObject({
				schemaVersion: 2,
				counts: { iterations: 2 },
				recording: {
					counts: { modelCalls: 2 },
					coverage: {
						assistantMessages: 2,
						linked: 2,
						unlinkedMessageIds: [],
					},
				},
			});
			expect(summary.files).toEqual(
				expect.arrayContaining([
					`sessions/${sessionId}/requests/requests.jsonl`,
					`sessions/${sessionId}/requests/blobs.jsonl`,
				]),
			);
			const requests = readFileSync(
				path.join(
					bundleDir,
					"sessions",
					sessionId,
					"requests",
					"requests.jsonl",
				),
				"utf8",
			);
			expect(requests).not.toContain("sk-replay-e2e");

			const validated = await runCli(["session", "validate", bundleDir], {
				cwd: workspace,
				env: hubEnv,
			});
			expect(validated.status, validated.stderr).toBe(0);

			const json = await runCli(
				["session", "replay", bundleDir, "--format", "json"],
				{ cwd: workspace, env: hubEnv },
			);
			expect(json.status, json.stderr).toBe(0);
			const iterations = json.stdout
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(
				iterations.map((iteration) =>
					iteration.modelCalls.map(
						(call: { callIndex: number; outcome: string }) =>
							`${call.callIndex}:${call.outcome}`,
					),
				),
			).toEqual([["0:completed"], ["1:completed"]]);
			expect(
				iterations[0].events
					.filter((event: { kind: string }) => event.kind === "decision")
					.map((event: { detail?: string }) => event.detail),
			).toEqual(["immediate prompt delivered (send)"]);

			const text = await runCli(["session", "replay", bundleDir], {
				cwd: workspace,
				env: hubEnv,
			});
			expect(text.status, text.stderr).toBe(0);
			expect(text.stdout).toContain("recording: 2 model calls");
			expect(text.stdout).toContain("decision +");
			expect(text.stdout).toContain("immediate prompt delivered (send)");
			expect(text.stdout).toMatch(
				/model call: call 0 · completed \(tool-calls\) · \d+ms · 2 messages · 120 in \/ 15 out · match [0-9a-f]{12}/,
			);
		} finally {
			await runCli(["hub", "stop"], { cwd: workspace, env: hubEnv });
		}
	}, 240_000);

	it("records --record-session sessions in a hub that is already running", async () => {
		const {
			env: hubEnv,
			dataDir,
			sessionsDir,
		} = await hubTestEnv("running-hub");
		try {
			const ensured = await runCli(["hub", "ensure"], {
				cwd: workspace,
				env: hubEnv,
			});
			expect(ensured.status, ensured.stderr).toBe(0);
			const hub = readHubDiscovery(dataDir);
			expect(hub?.hubId).toBeDefined();

			const run = await runCli(
				["--auto-approve", "true", "--record-session", "Run echo for me"],
				{ cwd: workspace, env: hubEnv, timeoutMs: 120_000 },
			);
			expect(run.status, run.stderr).toBe(0);
			expect(readHubDiscovery(dataDir)?.hubId).toBe(hub?.hubId);

			const sessionId = await onlySessionId(hubEnv);
			const header = JSON.parse(
				readFileSync(
					path.join(sessionsDir, sessionId, "recording", "recording.json"),
					"utf8",
				),
			) as { segments: Array<{ pid: number }> };
			expect(header.segments.map((segment) => segment.pid)).toEqual([hub?.pid]);

			const exported = await runCli(
				[
					"session",
					"export",
					sessionId,
					"--bundle",
					path.join(root, "running-hub-bundle"),
					"--json",
				],
				{ cwd: workspace, env: hubEnv },
			);
			expect(exported.status, exported.stderr).toBe(0);
			const { recording } = JSON.parse(exported.stdout);
			// Outside yolo mode the scripted submit does not end the run, so the
			// number of model calls varies.
			expect(recording.counts.modelCalls).toBeGreaterThanOrEqual(2);
			expect(recording.coverage).toMatchObject({
				assistantMessages: recording.counts.modelCalls,
				linked: recording.counts.modelCalls,
				unlinkedMessageIds: [],
			});
		} finally {
			await runCli(["hub", "stop"], { cwd: workspace, env: hubEnv });
		}
	}, 240_000);

	it("diffs two recordings of the same task iteration by iteration", async () => {
		const { env: diffEnv } = await hubTestEnv("diff");
		const seen = new Set<string>();
		const recordAndExport = async (systemPrompt: string, name: string) => {
			const run = await runCli(
				["-y", "--record-session", "-s", systemPrompt, "Run echo for me"],
				{ cwd: workspace, env: diffEnv },
			);
			expect(run.status, run.stderr).toBe(0);
			const history = await runCli(["history", "--json"], {
				cwd: workspace,
				env: diffEnv,
			});
			expect(history.status, history.stderr).toBe(0);
			const sessionId = (
				JSON.parse(history.stdout) as Array<{ sessionId: string }>
			)
				.map((session) => session.sessionId)
				.find((id) => !seen.has(id));
			expect(sessionId).toBeDefined();
			seen.add(sessionId ?? "");
			const bundleDir = path.join(root, `diff-${name}`);
			const exported = await runCli(
				["session", "export", sessionId ?? "", "--bundle", bundleDir, "--json"],
				{ cwd: workspace, env: diffEnv },
			);
			expect(exported.status, exported.stderr).toBe(0);
			expect(JSON.parse(exported.stdout).recording.counts.modelCalls).toBe(2);
			return bundleDir;
		};
		const diff = (args: string[]) =>
			runCli(["session", "diff", ...args], { cwd: workspace, env: diffEnv });

		try {
			const base = await recordAndExport(
				"You are a replay test agent.",
				"base",
			);
			const again = await recordAndExport(
				"You are a replay test agent.",
				"again",
			);
			const changed = await recordAndExport(
				"You are a replay test agent. Prefer short answers.",
				"changed",
			);

			const same = await diff([base, again, "--format", "json"]);
			expect(same.status, `${same.stderr}\n${same.stdout}`).toBe(0);
			expect(JSON.parse(same.stdout)).toMatchObject({
				strictness: "strict",
				iterations: { recorded: 2, live: 2 },
				perIteration: [
					{ iteration: 1, kinds: [] },
					{ iteration: 2, kinds: [] },
				],
				divergences: [],
				first: null,
				diverged: false,
				failed: false,
				warnings: [],
			});

			const divergent = await diff([base, changed, "--format", "json"]);
			expect(divergent.status, divergent.stderr).toBe(1);
			const report = JSON.parse(divergent.stdout);
			expect(report.first).toMatchObject({
				kind: "request-system-prompt",
				iteration: 1,
				counted: true,
				summary: "system prompt differs at line 1, column 29",
				entries: [
					{
						label: "system prompt",
						recorded: { excerpt: "…are a replay test agent." },
						live: {
							excerpt: "…are a replay test agent. Prefer short answers.",
						},
					},
				],
			});
			expect(
				report.divergences.map(
					(divergence: { iteration: number; kind: string }) =>
						`${divergence.iteration}:${divergence.kind}`,
				),
			).toEqual(["1:request-system-prompt", "2:request-system-prompt"]);

			const text = await diff([base, changed]);
			expect(text.status, text.stderr).toBe(1);
			expect(text.stdout).toContain("  iteration 1  request-system-prompt");
			expect(text.stdout).toContain(
				"  iteration 1 · request-system-prompt · system prompt differs at line 1, column 29",
			);
			expect(text.stdout).toContain(
				"Result: diverged · 2 counted divergences in 2 iterations",
			);

			const tolerated = await diff([
				base,
				changed,
				"--ignore",
				"request-system-prompt",
			]);
			expect(tolerated.status, tolerated.stderr).toBe(0);
			expect(tolerated.stdout).toContain(
				"Result: no divergence across 2 iterations · 2 not counted",
			);
		} finally {
			await runCli(["hub", "stop"], { cwd: workspace, env: diffEnv });
		}
	}, 240_000);

	it("reruns a recorded session in a fresh copy of its workspace and reports divergences", async () => {
		const { env: rerunEnv } = await hubTestEnv("rerun");
		const repo = path.join(root, "rerun-repo");
		mkdirSync(repo, { recursive: true });
		const git = (...args: string[]) =>
			execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
		git("init", "--quiet");
		git("config", "user.email", "replay@example.com");
		git("config", "user.name", "Replay");
		writeFileSync(path.join(repo, "notes.txt"), "committed\n");
		git("add", ".");
		git("commit", "--quiet", "-m", "base");
		writeFileSync(path.join(repo, "notes.txt"), "uncommitted\n");
		const rerun = (args: string[], cwd = workspace) =>
			runCli(["session", "replay", ...args], {
				cwd,
				env: rerunEnv,
				timeoutMs: 120_000,
			});

		try {
			fakeModelScript = "recorded";
			const recorded = await runCli(
				["-y", "--record-session", "Run echo for me"],
				{ cwd: repo, env: rerunEnv, timeoutMs: 120_000 },
			);
			expect(recorded.status, recorded.stderr).toBe(0);
			const sessionId = await onlySessionId(rerunEnv);
			const bundleDir = path.join(root, "rerun-bundle");
			const exported = await runCli(
				["session", "export", sessionId, "--bundle", bundleDir, "--json"],
				{ cwd: workspace, env: rerunEnv },
			);
			expect(exported.status, exported.stderr).toBe(0);
			const manifest = JSON.parse(
				readFileSync(path.join(bundleDir, "manifest.json"), "utf8"),
			);
			expect(manifest.sessions[0].checkpoints[0]).toMatchObject({
				runCount: 1,
			});
			writeFileSync(path.join(repo, "notes.txt"), "changed after recording\n");

			// Same model script: nothing that counts diverges.
			const sameOut = path.join(root, "rerun-same");
			const same = await rerun([
				bundleDir,
				"--mode",
				"rerun",
				"--format",
				"json",
				"--out",
				sameOut,
			]);
			expect(same.status, `${same.stderr}\n${same.stdout}`).toBe(0);
			const sameReport = JSON.parse(same.stdout);
			expect(sameReport).toMatchObject({
				format: "cline.session-replay-rerun-report",
				recorded: { bundleDir, sessionId },
				live: {
					bundleDir: path.join(sameOut, "bundle"),
					validated: true,
				},
				workspace: {
					method: "checkpoint",
					source: repo,
					root: path.join(sameOut, "workspace", "rerun-repo"),
				},
				options: {
					requestMatching: "strict",
					untilDivergence: false,
					provider: "openai-compatible",
					model: "fake-model",
				},
				turns: { recorded: 1, sent: 1 },
				stopped: null,
				comparison: {
					iterations: { recorded: 2, live: 2 },
					first: null,
					diverged: false,
				},
			});
			expect(sameReport.live.sessionId).not.toBe(sessionId);
			expect(
				readFileSync(
					path.join(sameOut, "workspace", "rerun-repo", "notes.txt"),
					"utf8",
				),
			).toBe("uncommitted\n");
			expect(readFileSync(path.join(repo, "notes.txt"), "utf8")).toBe(
				"changed after recording\n",
			);
			expect(
				JSON.parse(
					readFileSync(path.join(sameOut, "rerun-report.json"), "utf8"),
				).live.sessionId,
			).toBe(sameReport.live.sessionId);
			const validated = await runCli(
				["session", "validate", path.join(sameOut, "bundle")],
				{ cwd: workspace, env: rerunEnv },
			);
			expect(validated.status, validated.stderr).toBe(0);
			const history = await runCli(["history", "--json"], {
				cwd: workspace,
				env: rerunEnv,
			});
			expect(
				(JSON.parse(history.stdout) as Array<{ sessionId: string }>).map(
					(session) => session.sessionId,
				),
			).toContain(sameReport.live.sessionId);

			const text = await rerun([
				bundleDir,
				"--mode",
				"rerun",
				"--format",
				"text",
				"--out",
				path.join(root, "rerun-text"),
			]);
			expect(text.status, text.stderr).toBe(0);
			expect(text.stderr).toContain("[rerun] workspace: checkpoint ");
			expect(text.stderr).toContain("[rerun] iteration 2  same");
			expect(text.stdout).toContain("Session rerun");
			expect(text.stdout).toContain(
				"Result: no divergence across 2 iterations",
			);
			expect(text.stdout).toContain(
				`Compare: cline session diff ${bundleDir} ${path.join(root, "rerun-text", "bundle")}`,
			);

			// A different tool call at iteration 2.
			fakeModelScript = "diverge";
			const continued = await rerun([
				bundleDir,
				"--mode",
				"rerun",
				"--format",
				"json",
				"--out",
				path.join(root, "rerun-continue"),
			]);
			expect(continued.status, continued.stderr).toBe(1);
			const continuedReport = JSON.parse(continued.stdout);
			expect(continuedReport.stopped).toBeNull();
			expect(continuedReport.comparison.first).toMatchObject({
				kind: "tool-calls",
				iteration: 2,
				counted: true,
			});
			expect(continuedReport.comparison.iterations).toEqual({
				recorded: 2,
				live: 3,
			});
			expect(
				continuedReport.comparison.divergences
					.filter((divergence: { counted: boolean }) => divergence.counted)
					.map(
						(divergence: { iteration: number; kind: string }) =>
							`${divergence.iteration}:${divergence.kind}`,
					),
			).toEqual(expect.arrayContaining(["2:tool-calls", "3:iteration-count"]));

			const stopped = await rerun([
				bundleDir,
				"--mode",
				"rerun",
				"--until-divergence",
				"--format",
				"json",
				"--out",
				path.join(root, "rerun-stop"),
			]);
			expect(stopped.status, stopped.stderr).toBe(1);
			const stoppedReport = JSON.parse(stopped.stdout);
			expect(stoppedReport.stopped).toEqual({
				reason: "until-divergence",
				iteration: 2,
				kind: "tool-calls",
			});
			expect(stoppedReport.comparison.first).toMatchObject({
				kind: "tool-calls",
				iteration: 2,
			});
			expect(stoppedReport.comparison.iterations.live).toBe(2);
			expect(stoppedReport.live.validated).toBe(true);

			const ignored = await rerun([
				bundleDir,
				"--mode",
				"rerun",
				"--ignore",
				"tool-calls,tool-results,iteration-count,request-messages",
				"--format",
				"json",
				"--out",
				path.join(root, "rerun-ignored"),
			]);
			expect(ignored.status, ignored.stderr).toBe(0);
			expect(JSON.parse(ignored.stdout).comparison.diverged).toBe(false);
			fakeModelScript = "recorded";

			// Without the recorded repository the rerun says what to pass.
			const moved = path.join(root, "rerun-repo-moved");
			renameSync(repo, moved);
			try {
				const missing = await rerun([
					bundleDir,
					"--mode",
					"rerun",
					"--format",
					"json",
					"--out",
					path.join(root, "rerun-missing"),
				]);
				expect(missing.status).toBe(2);
				expect(missing.stderr).toContain(
					`The recorded workspace ${repo} is not on this machine.`,
				);
				expect(missing.stderr).toContain("pass --workspace <path>");

				const elsewhere = await rerun([
					bundleDir,
					"--mode",
					"rerun",
					"--workspace",
					moved,
					"--format",
					"json",
					"--out",
					path.join(root, "rerun-elsewhere"),
				]);
				expect(elsewhere.status, elsewhere.stderr).toBe(0);
				expect(JSON.parse(elsewhere.stdout)).toMatchObject({
					workspace: { method: "checkpoint", source: moved },
					comparison: { diverged: false },
				});
			} finally {
				renameSync(moved, repo);
			}
		} finally {
			fakeModelScript = "recorded";
			await runCli(["hub", "stop"], { cwd: workspace, env: rerunEnv });
		}
	}, 600_000);

	it("refuses --record-session for runs that cannot use the hub", async () => {
		const sandboxed = await runCli(
			[
				"--data-dir",
				path.join(root, "sandbox"),
				"--record-session",
				"Run echo for me",
			],
			{ cwd: workspace, env },
		);
		expect(sandboxed.status).toBe(1);
		expect(sandboxed.stderr).toContain(
			"--record-session cannot be combined with --data-dir or CLINE_SANDBOX=1",
		);

		const local = await runCli(["-y", "--record-session", "Run echo for me"], {
			cwd: workspace,
			env: { ...env, CLINE_SESSION_BACKEND_MODE: "local" },
		});
		expect(local.status).toBe(1);
		expect(local.stderr).toContain(
			"--record-session needs the hub, but CLINE_SESSION_BACKEND_MODE=local is set.",
		);
	}, 60_000);
});

/** The hub discovery record under a data dir, if a hub has published one. */
function readHubDiscovery(
	dataDir: string,
): { hubId: string; pid?: number; url: string } | undefined {
	for (const dir of [
		path.join(dataDir, "locks", "hub"),
		path.join(dataDir, "locks", "hub", "owners"),
	]) {
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".json")) continue;
			try {
				const record = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
				if (typeof record?.hubId === "string") return record;
			} catch {
				// Not a discovery record.
			}
		}
	}
	return undefined;
}

// `hub stop` returns before the hub process exits, and the exiting hub
// rewrites its discovery lock under the data dir.
async function removeWhenSettled(dir: string): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 500));
		if (!existsSync(dir)) {
			return;
		}
	}
}

function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});
}
