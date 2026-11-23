import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	resolveClineDir,
	resolveDocumentsClineDirectoryPath,
	setClineDir,
	setHomeDir,
} from "@cline/shared/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createHookAuditHooks,
	createHookConfigFileExtension,
	createHookConfigFileHooks,
	getWindowsPythonFallbackCommand,
	mergeAgentHooks,
} from "./hook-file-hooks";

async function waitForFile(
	filePath: string,
	timeoutMs = 1500,
): Promise<string> {
	const started = Date.now();
	for (;;) {
		try {
			return await readFile(filePath, "utf8");
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error
					? String((error as { code?: unknown }).code)
					: undefined;
			if (code !== "ENOENT" || Date.now() - started >= timeoutMs) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
}

async function waitForJsonLines(
	filePath: string,
	expectedLines: number,
	timeoutMs = 1500,
): Promise<string[]> {
	const started = Date.now();
	for (;;) {
		const content = await waitForFile(
			filePath,
			Math.max(1, timeoutMs - (Date.now() - started)),
		);
		const lines = content.trim().split("\n").filter(Boolean);
		if (lines.length >= expectedLines) {
			return lines;
		}
		if (Date.now() - started >= timeoutMs) {
			return lines;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

async function createWorkspaceWithHook(
	fileName: string,
	body: string,
): Promise<{ workspace: string; hookPath: string }> {
	const workspace = await mkdtemp(join(tmpdir(), "hooks-workspace-"));
	const hooksDir = join(workspace, ".clinerules", "hooks");
	await mkdir(hooksDir, { recursive: true });
	const hookPath = join(hooksDir, fileName);
	await writeFile(hookPath, body, "utf8");
	return { workspace, hookPath };
}

function beforeToolContext(input: unknown = { path: "README.md" }) {
	return {
		snapshot: {
			agentId: "agent_1",
			conversationId: "conv_1",
			runId: "run_1",
			status: "running" as const,
			iteration: 1,
			messages: [],
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		tool: {
			name: "read_file",
			description: "",
			inputSchema: {},
			execute: async () => "",
		},
		toolCall: {
			type: "tool-call" as const,
			toolCallId: "call_1",
			toolName: "read_file",
			input,
		},
		input,
	};
}

function afterToolContext(input: unknown = { path: "README.md" }) {
	const startedAt = new Date("2026-01-01T00:00:00.000Z");
	const endedAt = new Date("2026-01-01T00:00:00.037Z");
	const before = beforeToolContext(input);
	return {
		...before,
		result: { output: "ok" },
		startedAt,
		endedAt,
		durationMs: 37,
	};
}

describe("createHookConfigFileHooks", () => {
	const originalHomeDir = dirname(
		dirname(resolveDocumentsClineDirectoryPath()),
	);
	const originalClineDir = resolveClineDir();
	let isolatedRoot = "";

	beforeAll(async () => {
		isolatedRoot = await mkdtemp(join(tmpdir(), "hooks-home-"));
		const isolatedHomeDir = join(isolatedRoot, "home");
		const isolatedClineDir = join(isolatedRoot, "cline");
		await mkdir(isolatedHomeDir, { recursive: true });
		await mkdir(isolatedClineDir, { recursive: true });
		setHomeDir(isolatedHomeDir);
		setClineDir(isolatedClineDir);
	});

	afterAll(async () => {
		setHomeDir(originalHomeDir);
		setClineDir(originalClineDir);
		if (isolatedRoot) {
			await rm(isolatedRoot, { recursive: true, force: true });
		}
	});

	it("ignores example hook files", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse.example",
			'echo \'HOOK_CONTROL\t{"cancel":true,"context":"should-not-run"}\'\n',
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			expect(hooks).toBeUndefined();
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("executes extensionless legacy hook files via bash fallback", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse",
			'echo \'HOOK_CONTROL\t{"cancel":true,"context":"legacy-ok"}\'\nexit 0\n',
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			expect(hooks?.beforeTool).toBeTypeOf("function");
			const control = await hooks?.beforeTool?.(beforeToolContext());
			expect(control).toMatchObject({ stop: true });
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("adapts file hooks into an AgentExtension", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse",
			'echo \'HOOK_CONTROL\t{"cancel":true,"context":"extension-ok"}\'\nexit 0\n',
		);
		try {
			const extension = createHookConfigFileExtension({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			expect(extension?.name).toBe("core.hook_config_files");
			expect(extension?.manifest).toMatchObject({
				capabilities: ["hooks"],
			});
			const control = await extension?.hooks?.beforeTool?.({
				snapshot: {
					agentId: "agent_1",
					conversationId: "conv_1",
					status: "running",
					iteration: 1,
					messages: [],
					pendingToolCalls: [],
					usage: {
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
					},
				},
				tool: {
					name: "read_file",
					description: "",
					inputSchema: {},
					execute: async () => "",
				},
				toolCall: {
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "read_file",
					input: { path: "README.md" },
				},
				input: { path: "README.md" },
			});
			expect(control).toMatchObject({ stop: true });
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("honors shebang interpreter when present", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse",
			'#!/usr/bin/env bash\necho \'HOOK_CONTROL\t{"cancel":false,"context":"shebang-ok"}\'\n',
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			expect(hooks?.beforeTool).toBeTypeOf("function");
			const control = await hooks?.beforeTool?.(beforeToolContext());
			expect(control).toEqual({ appendContext: "shebang-ok" });
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("parses review control from hook output", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse.js",
			'console.log(\'HOOK_CONTROL\\t{"review":true,"context":"needs-review"}\')\n',
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			expect(hooks?.beforeTool).toBeTypeOf("function");
			const ctx = beforeToolContext({ commands: ["git status"] });
			ctx.tool.name = "run_commands";
			ctx.toolCall.toolName = "run_commands";
			const control = await hooks?.beforeTool?.(ctx);
			expect(control).toEqual({ appendContext: "needs-review" });
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("executes python hook files", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse.py",
			'print(\'HOOK_CONTROL\\t{"cancel": false, "context": "python-ok"}\')\n',
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			expect(hooks?.beforeTool).toBeTypeOf("function");
			const control = await hooks?.beforeTool?.(beforeToolContext());
			expect(control).toEqual({ appendContext: "python-ok" });
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	}, 15000);

	it("returns appendContext from legacy contextModification output", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse.js",
			`console.log('HOOK_CONTROL\\t' + JSON.stringify({ cancel: false, contextModification: "WORKSPACE_NOTE: the codename is PREM-1188." }))\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			expect(hooks?.beforeTool).toBeTypeOf("function");
			const control = await hooks?.beforeTool?.(beforeToolContext());
			expect(control).toEqual({
				appendContext: "WORKSPACE_NOTE: the codename is PREM-1188.",
			});
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("returns appendContext from a TaskStart hook", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"TaskStart.js",
			`console.log('HOOK_CONTROL\\t' + JSON.stringify({ cancel: false, contextModification: "RUN_NOTE: injected at start." }))\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
				blockingRunStartHooks: true,
			});
			expect(hooks?.beforeRun).toBeTypeOf("function");
			const result = await hooks?.beforeRun?.({
				snapshot: beforeToolContext().snapshot,
			});
			expect(result).toEqual({
				appendContext: "RUN_NOTE: injected at start.",
			});
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("keeps TaskStart fire-and-forget by default, ignoring its control", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"TaskStart.js",
			`console.log('HOOK_CONTROL\t' + JSON.stringify({ cancel: true, contextModification: "never honored by default" }))\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			expect(hooks?.beforeRun).toBeTypeOf("function");
			const result = await hooks?.beforeRun?.({
				snapshot: beforeToolContext().snapshot,
			});
			expect(result).toBeUndefined();
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("reports how long a detached run-start hook ran", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"TaskStart.js",
			`setTimeout(() => {}, 20)\n`,
		);
		const observed: Array<{
			hookName: string;
			durationMs: number;
			exited: boolean;
		}> = [];
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				// The observer exists for the real fire-and-forget path, which is
				// what production uses.
				detachAsyncHooks: true,
				onHookRuntime: (event) => observed.push(event),
			});
			await hooks?.beforeRun?.({ snapshot: beforeToolContext().snapshot });
			await vi.waitFor(() => expect(observed.length).toBeGreaterThan(0), {
				timeout: 5000,
			});
			expect(observed[0].hookName).toBe("agent_start");
			expect(observed[0].exited).toBe(true);
			expect(observed[0].durationMs).toBeGreaterThanOrEqual(0);
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("stops the run when a TaskStart hook cancels", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"TaskStart.js",
			`console.log('HOOK_CONTROL\\t' + JSON.stringify({ cancel: true, errorMessage: "blocked at start" }))\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
				blockingRunStartHooks: true,
			});
			const result = await hooks?.beforeRun?.({
				snapshot: beforeToolContext().snapshot,
			});
			expect(result).toEqual({ stop: true, reason: "blocked at start" });
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("does not inject context when the hook cancels", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse.js",
			`console.log('HOOK_CONTROL\\t' + JSON.stringify({ cancel: true, errorMessage: "blocked by policy" }))\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			const control = await hooks?.beforeTool?.(beforeToolContext());
			expect(control).toEqual({ stop: true, reason: "blocked by policy" });
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("truncates oversized hook context", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse.js",
			`console.log('HOOK_CONTROL\\t' + JSON.stringify({ cancel: false, contextModification: "x".repeat(60_000) }))\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			const control = await hooks?.beforeTool?.(beforeToolContext());
			expect(control?.appendContext?.startsWith("xxx")).toBe(true);
			expect(control?.appendContext).toContain("[hook context truncated");
			expect(control?.appendContext?.length).toBeLessThan(50_200);
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("collects PostToolUse context and returns it from afterTool", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PostToolUse.js",
			`console.log('HOOK_CONTROL\\t' + JSON.stringify({ cancel: false, contextModification: "LINT_RESULTS: 3 errors in src/foo.ts" }))\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			expect(hooks?.afterTool).toBeTypeOf("function");
			const control = await hooks?.afterTool?.(afterToolContext());
			expect(control).toEqual({
				appendContext: "LINT_RESULTS: 3 errors in src/foo.ts",
			});
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("honors PostToolUse cancel with the hook's error message as reason", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PostToolUse.js",
			`console.log('HOOK_CONTROL\\t' + JSON.stringify({ cancel: true, errorMessage: "post-hook says stop" }))\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			const control = await hooks?.afterTool?.(afterToolContext());
			expect(control).toEqual({
				stop: true,
				reason: "post-hook says stop",
			});
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("prefers errorMessage over context for a cancelling hook's reason", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PostToolUse.js",
			`console.log('HOOK_CONTROL\\t' + JSON.stringify({ cancel: true, contextModification: "some context", errorMessage: "the actual error" }))\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			const control = await hooks?.afterTool?.(afterToolContext());
			expect(control).toEqual({
				stop: true,
				reason: "the actual error",
			});
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("falls back to context for the reason when errorMessage is blank", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PostToolUse.js",
			`console.log('HOOK_CONTROL\\t' + JSON.stringify({ cancel: true, contextModification: "the real reason", errorMessage: "   " }))\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			const control = await hooks?.afterTool?.(afterToolContext());
			expect(control).toEqual({
				stop: true,
				reason: "the real reason",
			});
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("keeps another hook's context out of a cancelling hook's reason", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PostToolUse",
			'echo \'HOOK_CONTROL\t{"cancel":false,"contextModification":"unrelated lint context"}\'\n',
		);
		try {
			await writeFile(
				join(workspace, ".clinerules", "hooks", "PostToolUse.js"),
				`console.log('HOOK_CONTROL\\t' + JSON.stringify({ cancel: true, errorMessage: "post-hook says stop" }))\n`,
				"utf8",
			);
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			const control = await hooks?.afterTool?.(afterToolContext());
			expect(control).toEqual({
				stop: true,
				reason: "post-hook says stop",
			});
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("concatenates appendContext across merged hook layers", async () => {
		const hooks = mergeAgentHooks([
			{
				beforeTool: async () => ({ appendContext: "layer-a" }),
			},
			{
				beforeTool: async () => ({ appendContext: "layer-b" }),
			},
		]);

		const control = await hooks?.beforeTool?.(beforeToolContext());

		expect(control).toMatchObject({
			appendContext: "layer-a\n\nlayer-b",
		});
	});

	it("falls back from py -3 to python when the Windows launcher is missing", () => {
		expect(
			getWindowsPythonFallbackCommand(["py", "-3", "hook.py"], "win32", {
				code: "ENOENT",
			}),
		).toEqual(["python", "hook.py"]);
		expect(
			getWindowsPythonFallbackCommand(["py", "-3", "-u", "hook.py"], "win32", {
				code: "ENOENT",
			}),
		).toEqual(["python", "-u", "hook.py"]);
	});

	it("does not rewrite python launch commands when fallback conditions are not met", () => {
		expect(
			getWindowsPythonFallbackCommand(["py", "-3", "hook.py"], "linux", {
				code: "ENOENT",
			}),
		).toBeUndefined();
		expect(
			getWindowsPythonFallbackCommand(["python", "hook.py"], "win32", {
				code: "ENOENT",
			}),
		).toBeUndefined();
		expect(
			getWindowsPythonFallbackCommand(["py", "-3", "hook.py"], "win32", {
				code: "EACCES",
			}),
		).toBeUndefined();
	});

	it.runIf(process.platform === "win32")(
		"executes PowerShell hook files on Windows",
		async () => {
			const { workspace } = await createWorkspaceWithHook(
				"PreToolUse.ps1",
				'Write-Output \'HOOK_CONTROL\t{"cancel": false, "context": "powershell-ok"}\'\n',
			);
			try {
				const hooks = createHookConfigFileHooks({
					cwd: workspace,
					workspacePath: workspace,
					detachAsyncHooks: false,
				});
				expect(hooks?.beforeTool).toBeTypeOf("function");
				const control = await hooks?.beforeTool?.(beforeToolContext());
				expect(control).toEqual({ appendContext: "powershell-ok" });
			} finally {
				await rm(workspace, {
					recursive: true,
					force: true,
					maxRetries: 3,
					retryDelay: 250,
				});
			}
		},
		30_000,
	);

	it("maps TaskError hook files to agent_error stop events", async () => {
		const outputPath = join(tmpdir(), `hooks-task-error-${Date.now()}.json`);
		const { workspace } = await createWorkspaceWithHook(
			"TaskError.js",
			`let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{require('node:fs').writeFileSync(${JSON.stringify(outputPath)}, data);});\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			await hooks?.afterRun?.({
				snapshot: beforeToolContext().snapshot,
				result: {
					agentId: "agent_1",
					runId: "conv_1",
					status: "failed",
					iterations: 3,
					outputText: "",
					messages: [],
					usage: beforeToolContext().snapshot.usage,
					error: new Error("401 unauthorized"),
				},
			});
			const payload = JSON.parse(await waitForFile(outputPath)) as {
				hookName: string;
				error?: { message?: string };
				taskId?: string;
			};
			expect(payload.hookName).toBe("agent_error");
			expect(payload.error?.message).toBe("401 unauthorized");
			expect(payload.taskId).toBe("conv_1");
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("writes audit tool timing and completed turn payloads", async () => {
		const outputPath = join(tmpdir(), `hooks-audit-${Date.now()}.jsonl`);
		const originalLogPath = process.env.CLINE_HOOKS_LOG_PATH;
		process.env.CLINE_HOOKS_LOG_PATH = outputPath;
		try {
			const hooks = createHookAuditHooks({
				workspacePath: "/workspace",
			});
			await hooks.afterTool?.(afterToolContext());
			await hooks.afterRun?.({
				snapshot: beforeToolContext().snapshot,
				result: {
					agentId: "agent_1",
					runId: "run_1",
					status: "completed",
					iterations: 1,
					outputText: "done",
					messages: [],
					usage: beforeToolContext().snapshot.usage,
				},
			});

			const payloads = (await readFile(outputPath, "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			const toolResult = payloads.find(
				(payload) => payload.hookName === "tool_result",
			);
			const agentEnd = payloads.find(
				(payload) => payload.hookName === "agent_end",
			);
			expect(toolResult.tool_result).toMatchObject({
				durationMs: 37,
				startedAt: "2026-01-01T00:00:00.000Z",
				endedAt: "2026-01-01T00:00:00.037Z",
			});
			expect(toolResult.postToolUse.executionTimeMs).toBe(37);
			expect(agentEnd.turn).toEqual({
				outputText: "done",
				status: "completed",
			});
		} finally {
			if (originalLogPath === undefined) {
				delete process.env.CLINE_HOOKS_LOG_PATH;
			} else {
				process.env.CLINE_HOOKS_LOG_PATH = originalLogPath;
			}
			await rm(outputPath, { force: true });
		}
	});

	it("merges before-model controls across hook layers", async () => {
		const hooks = mergeAgentHooks([
			{
				beforeModel: async () => ({
					options: { systemPrompt: "system-a" },
				}),
			},
			{
				beforeModel: async () => ({
					options: { extra: "ctx-a" },
				}),
			},
		]);

		const control = await hooks?.beforeModel?.({
			snapshot: beforeToolContext().snapshot,
			request: {
				messages: [],
				tools: [],
			},
		});

		expect(control).toMatchObject({
			options: { systemPrompt: "system-a", extra: "ctx-a" },
		});
	});

	it("dispatches agent_start and prompt_submit exactly once when both are configured", async () => {
		const outputPath = join(tmpdir(), `hooks-start-prompt-${Date.now()}.jsonl`);
		const { workspace } = await createWorkspaceWithHook(
			"TaskStart.js",
			`let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{require('node:fs').appendFileSync(${JSON.stringify(outputPath)}, data.trim()+"\\n");});\n`,
		);
		try {
			await writeFile(
				join(workspace, ".clinerules", "hooks", "UserPromptSubmit.js"),
				`let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{require('node:fs').appendFileSync(${JSON.stringify(outputPath)}, data.trim()+"\\n");});\n`,
				"utf8",
			);
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			const snapshot = beforeToolContext().snapshot;
			await hooks?.beforeRun?.({ snapshot: { ...snapshot, iteration: 0 } });
			await hooks?.onEvent?.({
				type: "message-added",
				snapshot,
				message: {
					id: "msg_1",
					role: "user",
					content: [{ type: "text", text: "real prompt" }],
					createdAt: 0,
				},
			});

			const payloads = (await waitForJsonLines(outputPath, 2)).map(
				(line) =>
					JSON.parse(line) as {
						hookName: string;
						userPromptSubmit?: { prompt?: string };
					},
			);
			expect(payloads.map((payload) => payload.hookName).sort()).toEqual([
				"agent_start",
				"prompt_submit",
			]);
			expect(
				payloads.find((payload) => payload.hookName === "prompt_submit")
					?.userPromptSubmit?.prompt,
			).toBe("real prompt");
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
			await rm(outputPath, { force: true });
		}
	});

	it("returns hooks and dispatches abort shutdown when only SessionShutdown is configured", async () => {
		const outputPath = join(
			tmpdir(),
			`hooks-session-shutdown-${Date.now()}.json`,
		);
		const { workspace } = await createWorkspaceWithHook(
			"SessionShutdown.js",
			`let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{require('node:fs').writeFileSync(${JSON.stringify(outputPath)}, data);});\n`,
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
				detachAsyncHooks: false,
			});
			expect(hooks?.afterRun).toBeTypeOf("function");
			await hooks?.afterRun?.({
				snapshot: beforeToolContext().snapshot,
				result: {
					agentId: "agent_1",
					runId: "run_1",
					status: "aborted",
					iterations: 1,
					outputText: "",
					messages: [],
					usage: beforeToolContext().snapshot.usage,
					error: new Error("user cancel"),
				},
			});

			const payload = JSON.parse(await waitForFile(outputPath)) as {
				hookName: string;
				reason?: string;
			};
			expect(payload.hookName).toBe("session_shutdown");
			expect(payload.reason).toBe("user cancel");
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
			await rm(outputPath, { force: true });
		}
	});
});
