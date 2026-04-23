import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendHookAudit,
	configureSandboxEnvironment,
	formatToolInput,
	formatToolOutput,
	isCliHookPayload,
	normalizeAutoApproveArgs,
	parseArgs,
} from "./helpers";

type EnvSnapshot = {
	CLINE_DATA_DIR: string | undefined;
	CLINE_DB_DATA_DIR: string | undefined;
	CLINE_HOOKS_LOG_PATH: string | undefined;
	CLINE_SESSION_ID: string | undefined;
	CLINE_SESSION_DATA_DIR: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_DB_DATA_DIR: process.env.CLINE_DB_DATA_DIR,
		CLINE_HOOKS_LOG_PATH: process.env.CLINE_HOOKS_LOG_PATH,
		CLINE_SESSION_ID: process.env.CLINE_SESSION_ID,
		CLINE_SESSION_DATA_DIR: process.env.CLINE_SESSION_DATA_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	process.env.CLINE_DB_DATA_DIR = snapshot.CLINE_DB_DATA_DIR;
	process.env.CLINE_HOOKS_LOG_PATH = snapshot.CLINE_HOOKS_LOG_PATH;
	process.env.CLINE_SESSION_ID = snapshot.CLINE_SESSION_ID;
	process.env.CLINE_SESSION_DATA_DIR = snapshot.CLINE_SESSION_DATA_DIR;
}

describe("parseArgs", () => {
	it("returns defaults when no arguments are supplied", () => {
		const parsed = parseArgs([]);
		expect(parsed).toEqual({
			verbose: false,
			interactive: false,
			showUsage: false,
			outputMode: "text",
			mode: "act",
			sandbox: false,
			acpMode: false,
			thinking: false,
			reasoningEffort: undefined,
			liveModelCatalog: false,
			defaultToolAutoApprove: true,
			kanban: false,
		});
	});

	it("parses prompt, runtime flags, and global approval settings", () => {
		const parsed = parseArgs([
			"--verbose",
			"--autoapprove",
			"false",
			"--cwd",
			"/tmp/work",
			"--team-name",
			"dev-team",
			"--provider",
			"openai",
			"--model",
			"gpt-5",
			"--key",
			"abc123",
			"--usage",
			"--thinking",
			"--reasoning-effort",
			"high",
			"--refresh-models",
			"--plan",
			"Audit",
			"the",
			"repo",
		]);

		expect(parsed.prompt).toBe("Audit the repo");
		expect(parsed.verbose).toBe(true);
		expect(parsed.defaultToolAutoApprove).toBe(false);
		expect(parsed.showUsage).toBe(true);
		expect(parsed.thinking).toBe(true);
		expect(parsed.reasoningEffort).toBe("high");
		expect(parsed.liveModelCatalog).toBe(true);
		expect(parsed.outputMode).toBe("text");
		expect(parsed.mode).toBe("plan");
		expect(parsed.cwd).toBe("/tmp/work");
		expect(parsed.teamName).toBe("dev-team");
		expect(parsed.provider).toBe("openai");
		expect(parsed.model).toBe("gpt-5");
		expect(parsed.key).toBe("abc123");
		expect(parsed.sandbox).toBe(false);
	});

	it("parses provider via -P shorthand", () => {
		const parsed = parseArgs(["-P", "cline"]);
		expect(parsed.provider).toBe("cline");
	});

	it("parses sandbox flags", () => {
		const parsed = parseArgs(["--sandbox", "--sandbox-dir", "./.tmp-cline"]);
		expect(parsed.sandbox).toBe(true);
		expect(parsed.sandboxDir).toBe("./.tmp-cline");
	});

	it("parses --autoapprove false as global approval-off", () => {
		const parsed = parseArgs([
			"--autoapprove",
			"false",
			"tell me about this repo",
		]);
		expect(parsed.defaultToolAutoApprove).toBe(false);
		expect(parsed.prompt).toBe("tell me about this repo");
	});

	it("treats bare --autoapprove as true", () => {
		expect(
			normalizeAutoApproveArgs(["--autoapprove", "Audit the repo"]),
		).toEqual(["--autoapprove", "true", "Audit the repo"]);
		const parsed = parseArgs(["--autoapprove", "Audit the repo"]);
		expect(parsed.defaultToolAutoApprove).toBe(true);
		expect(parsed.prompt).toBe("Audit the repo");
	});

	it("records invalid --autoapprove values", () => {
		const parsed = parseArgs(["--autoapprove=maybe"]);
		expect(parsed.invalidAutoApprove).toBe("maybe");
	});

	it("supports json output flags and validates explicit output modes", () => {
		const parsedJsonAlias = parseArgs(["--json", "hello"]);
		expect(parsedJsonAlias.outputMode).toBe("json");
		expect(parsedJsonAlias.prompt).toBe("hello");
	});

	it("parses act/plan mode flags", () => {
		const parsedPlan = parseArgs(["--plan"]);
		expect(parsedPlan.mode).toBe("plan");

		const parsedAct = parseArgs(["-a"]);
		expect(parsedAct.mode).toBe("act");
	});

	it("parses and validates reasoning effort", () => {
		const parsedInvalid = parseArgs(["--reasoning-effort", "ultra"]);
		expect(parsedInvalid.reasoningEffort).toBeUndefined();
		expect(parsedInvalid.invalidReasoningEffort).toBe("ultra");
	});

	it("parses task resume flag", () => {
		const parsed = parseArgs(["-T", "session_123"]);
		expect(parsed.taskId).toBe("session_123");
	});

	it("parses max consecutive mistakes when valid", () => {
		const parsed = parseArgs(["--max-consecutive-mistakes", "5"]);
		expect(parsed.maxConsecutiveMistakes).toBe(5);
		expect(parsed.invalidMaxConsecutiveMistakes).toBeUndefined();
	});

	it("supports yolo as an auto-approval shortcut", () => {
		const parsedYolo = parseArgs(["--yolo"]);
		expect(parsedYolo.mode).toBe("yolo");
		expect(parsedYolo.defaultToolAutoApprove).toBe(true);
	});

	it("parses --zen flag for background hub dispatch", () => {
		const parsedLong = parseArgs(["--zen", "do it"]);
		expect(parsedLong.mode).toBe("zen");
		expect(parsedLong.prompt).toBe("do it");

		const parsedShort = parseArgs(["-z", "do it"]);
		expect(parsedShort.mode).toBe("zen");
	});

	it("parses timeout and validates invalid values", () => {
		const parsed = parseArgs(["-t", "30"]);
		expect(parsed.timeoutSeconds).toBe(30);

		const invalid = parseArgs(["--timeout", "abc"]);
		expect(invalid.invalidTimeoutSeconds).toBe("abc");
	});

	it("records invalid max consecutive mistakes values", () => {
		const parsed = parseArgs(["--max-consecutive-mistakes", "0"]);
		expect(parsed.maxConsecutiveMistakes).toBeUndefined();
		expect(parsed.invalidMaxConsecutiveMistakes).toBe("0");
	});
});

describe("format helpers", () => {
	it("truncates run_commands with commands array", () => {
		const result = formatToolInput("run_commands", {
			commands: [
				"echo hello",
				"npm run very-very-long-command-name-that-will-truncate",
			],
		});
		expect(result).toContain("echo hello");
		expect(result.length).toBeLessThanOrEqual(120);
	});

	it("truncates run_commands with commands as single string", () => {
		const longCmd = `echo ${"x".repeat(200)}`;
		const result = formatToolInput("run_commands", { commands: longCmd });
		expect(result).toContain("echo");
		expect(result.length).toBeLessThanOrEqual(120);
	});

	it("truncates run_commands with bare string input", () => {
		const longCmd = `echo ${"x".repeat(200)}`;
		const result = formatToolInput("run_commands", longCmd);
		expect(result).toContain("echo");
		expect(result.length).toBeLessThanOrEqual(120);
	});

	it("truncates run_commands with bare string array input", () => {
		const result = formatToolInput("run_commands", [
			"echo hello",
			"echo world",
		]);
		expect(result).toContain("echo hello; echo world");
	});

	it("truncates run_commands with structured command input", () => {
		const result = formatToolInput("run_commands", {
			commands: [{ command: "git", args: ["status", "--short"] }],
		});
		expect(result).toContain("git status --short");
	});

	it("truncates run_commands with bare structured command", () => {
		const result = formatToolInput("run_commands", {
			command: "git",
			args: ["log", "--oneline"],
		});
		expect(result).toContain("git log --oneline");
	});

	it("handles structured command with non-array args gracefully", () => {
		const result = formatToolInput("run_commands", {
			commands: [{ command: "git", args: "status" }],
		});
		expect(result).toBe("git");
	});

	it("formats known tool input payloads with truncation", () => {
		expect(
			formatToolInput("team_run_task", {
				runMode: "sync",
				agentId: "coder",
				task: "implement feature with extensive acceptance criteria and checks",
			}),
		).toContain("sync coder:");
		expect(
			formatToolInput("team_member", {
				action: "spawn",
				agentId: "reviewer",
				rolePrompt: "Review changes and call out risks",
			}),
		).toContain("spawn reviewer:");
		expect(
			formatToolInput("team_task", {
				action: "complete",
				taskId: "task_0012",
				summary: "Done and verified",
			}),
		).toContain("complete task_0012:");
		expect(
			formatToolInput("team_message", {
				action: "send",
				toAgentId: "lead",
				subject: "Status update",
			}),
		).toContain("send lead:");
	});

	it("formats ask_question as a readable prompt", () => {
		expect(
			formatToolInput("ask_question", {
				question: "How can I best assist you today?",
				options: [
					"Help me understand or analyze code in a repository",
					"Help me create or edit files",
					"Help me run commands or tests",
				],
			}),
		).toBe(
			[
				"The agent is waiting for your input.",
				"How can I best assist you today?",
				"1. Help me understand or analyze code in a repository",
				"2. Help me create or edit files",
				"3. Help me run commands or tests",
				"> Reply with an option number or type your answer.",
			].join("\n"),
		);
	});

	it("summarizes structured tool outputs", () => {
		expect(formatToolOutput("simple text output")).toBe("simple text output");
		expect(
			formatToolOutput([
				{ result: "first" },
				{ result: "second" },
				{ result: "third" },
			]),
		).toBe("first (+2 more)");
		expect(formatToolOutput(null)).toBe("");
	});
});

describe("hook payload validation and audit logging", () => {
	let tempDir = "";

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
			tempDir = "";
		}
	});

	it("validates hook payload structure", async () => {
		expect(
			await isCliHookPayload({
				clineVersion: "",
				hookName: "tool_call",
				timestamp: new Date().toISOString(),
				taskId: "conv_1",
				workspaceRoots: [],
				userId: "agent_1",
				agent_id: "agent_1",
				parent_agent_id: null,
				iteration: 1,
				tool_call: {
					id: "call_1",
					name: "read_files",
					input: { file_paths: ["README.md"] },
				},
			}),
		).toBe(true);
		expect(await isCliHookPayload({ hookName: "tool_call" })).toBe(false);
		expect(await isCliHookPayload(null)).toBe(false);
	});

	it("writes hook audits to global log", async () => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "cli-helper-audit-"));
		const expectedPath = path.join(tempDir, "logs", "hooks.jsonl");
		const env = captureEnv();
		process.env.CLINE_DATA_DIR = tempDir;
		delete process.env.CLINE_HOOKS_LOG_PATH;
		delete process.env.CLINE_SESSION_ID;
		delete process.env.CLINE_SESSION_DATA_DIR;

		await appendHookAudit({
			clineVersion: "",
			hookName: "tool_call",
			timestamp: new Date().toISOString(),
			taskId: "conv_1",
			sessionContext: { rootSessionId: "session_from_context" },
			workspaceRoots: [],
			userId: "agent_1",
			iteration: 1,
			agent_id: "agent_1",
			parent_agent_id: null,
			tool_call: {
				id: "call_1",
				name: "read_files",
				input: { file_paths: ["README.md"] },
			},
		});
		restoreEnv(env);

		expect(existsSync(expectedPath)).toBe(true);
		const content = readFileSync(expectedPath, "utf8");
		expect(content).toContain('"hookName":"tool_call"');
		expect(content).toContain('"agent_id":"agent_1"');
	});

	it("writes hook audits to CLINE_HOOKS_LOG_PATH when set", async () => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "cli-helper-env-audit-"));
		const expectedPath = path.join(tempDir, "hooks", "from-env.jsonl");
		const env = captureEnv();
		process.env.CLINE_HOOKS_LOG_PATH = expectedPath;
		delete process.env.CLINE_DATA_DIR;
		delete process.env.CLINE_SESSION_ID;
		delete process.env.CLINE_SESSION_DATA_DIR;

		await appendHookAudit({
			clineVersion: "",
			hookName: "tool_result",
			timestamp: new Date().toISOString(),
			taskId: "conv_3",
			workspaceRoots: [],
			userId: "agent_3",
			iteration: 1,
			agent_id: "agent_3",
			parent_agent_id: null,
			tool_result: {
				id: "call_3",
				name: "read_files",
				input: { file_paths: ["README.md"] },
				output: "ok",
				durationMs: 5,
				startedAt: new Date("2026-01-01T00:00:00.000Z"),
				endedAt: new Date("2026-01-01T00:00:00.005Z"),
			},
		});
		restoreEnv(env);

		expect(existsSync(expectedPath)).toBe(true);
		const content = readFileSync(expectedPath, "utf8");
		expect(content).toContain('"hookName":"tool_result"');
	});
});

describe("sandbox environment", () => {
	it("sets sandbox-specific storage paths", () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "cli-helper-sandbox-"));
		const previous = {
			CLINE_SANDBOX: process.env.CLINE_SANDBOX,
			CLINE_SANDBOX_DATA_DIR: process.env.CLINE_SANDBOX_DATA_DIR,
			CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
			CLINE_DB_DATA_DIR: process.env.CLINE_DB_DATA_DIR,
			CLINE_SESSION_DATA_DIR: process.env.CLINE_SESSION_DATA_DIR,
			CLINE_TEAM_DATA_DIR: process.env.CLINE_TEAM_DATA_DIR,
			CLINE_PROVIDER_SETTINGS_PATH: process.env.CLINE_PROVIDER_SETTINGS_PATH,
			CLINE_HOOKS_LOG_PATH: process.env.CLINE_HOOKS_LOG_PATH,
		};
		try {
			const resolved = configureSandboxEnvironment({
				enabled: true,
				cwd: root,
				explicitDir: "./sandbox-state",
			});
			expect(resolved).toBe(path.join(root, "sandbox-state"));
			expect(process.env.CLINE_SANDBOX).toBe("1");
			expect(process.env.CLINE_SANDBOX_DATA_DIR).toBe(
				path.join(root, "sandbox-state"),
			);
			expect(process.env.CLINE_DATA_DIR).toBe(path.join(root, "sandbox-state"));
			expect(process.env.CLINE_DB_DATA_DIR).toBe(
				path.join(root, "sandbox-state", "db"),
			);
			expect(process.env.CLINE_SESSION_DATA_DIR).toBe(
				path.join(root, "sandbox-state", "sessions"),
			);
			expect(process.env.CLINE_TEAM_DATA_DIR).toBe(
				path.join(root, "sandbox-state", "teams"),
			);
			expect(process.env.CLINE_PROVIDER_SETTINGS_PATH).toBe(
				path.join(root, "sandbox-state", "settings", "providers.json"),
			);
			expect(process.env.CLINE_HOOKS_LOG_PATH).toBe(
				path.join(root, "sandbox-state", "logs", "hooks.jsonl"),
			);
		} finally {
			process.env.CLINE_SANDBOX = previous.CLINE_SANDBOX;
			process.env.CLINE_SANDBOX_DATA_DIR = previous.CLINE_SANDBOX_DATA_DIR;
			process.env.CLINE_DATA_DIR = previous.CLINE_DATA_DIR;
			process.env.CLINE_DB_DATA_DIR = previous.CLINE_DB_DATA_DIR;
			process.env.CLINE_SESSION_DATA_DIR = previous.CLINE_SESSION_DATA_DIR;
			process.env.CLINE_TEAM_DATA_DIR = previous.CLINE_TEAM_DATA_DIR;
			process.env.CLINE_PROVIDER_SETTINGS_PATH =
				previous.CLINE_PROVIDER_SETTINGS_PATH;
			process.env.CLINE_HOOKS_LOG_PATH = previous.CLINE_HOOKS_LOG_PATH;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
