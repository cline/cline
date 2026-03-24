import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHookConfigFileHooks } from "./hook-file-hooks";

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
			await rm(workspace, { recursive: true, force: true });
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
			await rm(workspace, { recursive: true, force: true });
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
			await rm(workspace, { recursive: true, force: true });
		}
	});

	it("parses review control from hook output", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse.ts",
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
			await rm(workspace, { recursive: true, force: true });
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
			await rm(workspace, { recursive: true, force: true });
		}
	});

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
			await rm(workspace, { recursive: true, force: true });
		}
	});
});
