import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
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
			const sawToolResult = messages.some((message) => message.role === "tool");
			res.writeHead(200, { "content-type": "text/event-stream" });
			if (sawToolResult) {
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
			rmSync(root, { recursive: true, force: true });
		}
	});

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
			schemaVersion: 1,
			counts: { iterations: 2 },
			eventsSource: "session-log",
			redaction: { enabled: true },
		});

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
			"Session replay bundle uses schemaVersion 99, but this version of Cline reads bundles up to schemaVersion 1.",
		);
	}, 180_000);
});
