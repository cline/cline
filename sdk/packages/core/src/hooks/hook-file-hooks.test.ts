import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	resolveClineDir,
	resolveDocumentsClineDirectoryPath,
	setClineDir,
	setHomeDir,
} from "@clinebot/shared/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
			});
			expect(hooks?.onToolCallStart).toBeTypeOf("function");
			const control = await hooks?.onToolCallStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				call: {
					id: "call_1",
					name: "read_file",
					input: { path: "README.md" },
				},
			});
			expect(control).toMatchObject({ cancel: true, context: "legacy-ok" });
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
			});
			expect(extension?.name).toBe("core.hook_config_files");
			expect(extension?.manifest).toMatchObject({
				capabilities: ["hooks"],
			});
			expect(extension?.manifest.hookStages).toContain("tool_call_before");
			const control = await extension?.onToolCall?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				call: {
					id: "call_1",
					name: "read_file",
					input: { path: "README.md" },
				},
			});
			expect(control).toMatchObject({ cancel: true, context: "extension-ok" });
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
			});
			expect(hooks?.onToolCallStart).toBeTypeOf("function");
			const control = await hooks?.onToolCallStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				call: {
					id: "call_1",
					name: "read_file",
					input: { path: "README.md" },
				},
			});
			expect(control).toMatchObject({ cancel: false, context: "shebang-ok" });
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
			});
			expect(hooks?.onToolCallStart).toBeTypeOf("function");
			const control = await hooks?.onToolCallStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				call: {
					id: "call_1",
					name: "run_commands",
					input: { commands: ["git status"] },
				},
			});
			expect(control).toMatchObject({
				review: true,
				context: "needs-review",
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

	it("executes python hook files", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse.py",
			'print(\'HOOK_CONTROL\\t{"cancel": false, "context": "python-ok"}\')\n',
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
			});
			expect(hooks?.onToolCallStart).toBeTypeOf("function");
			const control = await hooks?.onToolCallStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				call: {
					id: "call_1",
					name: "read_file",
					input: { path: "README.md" },
				},
			});
			expect(control).toMatchObject({
				cancel: false,
				context: "python-ok",
			});
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	}, 15000);

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
				});
				expect(hooks?.onToolCallStart).toBeTypeOf("function");
				const control = await hooks?.onToolCallStart?.({
					agentId: "agent_1",
					conversationId: "conv_1",
					parentAgentId: null,
					iteration: 1,
					call: {
						id: "call_1",
						name: "read_file",
						input: { path: "README.md" },
					},
				});
				expect(control).toMatchObject({
					cancel: false,
					context: "powershell-ok",
				});
			} finally {
				await rm(workspace, {
					recursive: true,
					force: true,
					maxRetries: 3,
					retryDelay: 250,
				});
			}
		},
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
			});
			await hooks?.onStopError?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 3,
				error: new Error("401 unauthorized"),
			});
			const payload = JSON.parse(await waitForFile(outputPath)) as {
				hookName: string;
				error?: { message?: string };
			};
			expect(payload.hookName).toBe("agent_error");
			expect(payload.error?.message).toBe("401 unauthorized");
		} finally {
			await rm(workspace, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 250,
			});
		}
	});

	it("merges before-agent-start controls across hook layers", async () => {
		const hooks = mergeAgentHooks([
			{
				onBeforeAgentStart: async () => ({
					systemPrompt: "system-a",
				}),
			},
			{
				onBeforeAgentStart: async () => ({
					appendMessages: [
						{
							role: "user",
							content: [{ type: "text", text: "ctx-a" }],
						},
					],
				}),
			},
		]);

		const control = await hooks?.onBeforeAgentStart?.({
			agentId: "agent_1",
			conversationId: "conv_1",
			parentAgentId: null,
			iteration: 1,
			systemPrompt: "base",
			messages: [],
		});

		expect(control).toMatchObject({
			systemPrompt: "system-a",
			appendMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "ctx-a" }],
				},
			],
		});
	});
});
