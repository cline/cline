import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSubprocessHooks, runHook } from "./subprocess";

const tmpPaths: string[] = [];

async function waitForFileContents(
	filePath: string,
	predicate: (contents: string) => boolean,
	timeoutMs = 1500,
): Promise<string> {
	const started = Date.now();
	for (;;) {
		try {
			const contents = await readFile(filePath, "utf8");
			if (predicate(contents)) {
				return contents;
			}
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error
					? String((error as { code?: unknown }).code)
					: undefined;
			if (code !== "ENOENT" || Date.now() - started >= timeoutMs) {
				throw error;
			}
		}
		if (Date.now() - started >= timeoutMs) {
			throw new Error(`Timed out waiting for hook output at ${filePath}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

afterEach(async () => {
	for (const path of tmpPaths) {
		await rm(path, { recursive: true, force: true });
	}
	tmpPaths.length = 0;
});

async function waitFor<T>(
	read: () => Promise<T>,
	accept: (value: T) => boolean,
	options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? 2_000;
	const intervalMs = options.intervalMs ?? 25;
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			const value = await read();
			if (accept(value)) {
				return value;
			}
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

describe("hooks", () => {
	it("runHook pipes payload to command and parses JSON stdout", async () => {
		const result = await runHook(
			{
				clineVersion: "",
				hookName: "tool_call",
				timestamp: new Date().toISOString(),
				taskId: "conv-1",
				workspaceRoots: [],
				userId: "agent-1",
				agent_id: "agent-1",
				parent_agent_id: null,
				iteration: 1,
				tool_call: {
					id: "call-1",
					name: "read_file",
					input: { path: "README.md" },
				},
			},
			{
				command: [
					process.execPath,
					"-e",
					"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d);process.stdout.write(JSON.stringify({cancel:p.hookName==='tool_call',context:'ok'}));});",
				],
			},
		);

		expect(result?.exitCode).toBe(0);
		expect(result?.parsedJson).toEqual({ cancel: true, context: "ok" });
	});

	it("createSubprocessHooks maps lifecycle payloads and returns hook controls", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agents-hooks-"));
		tmpPaths.push(dir);
		const output = join(dir, "events.log");

		const script =
			"const fs=require('node:fs');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d);fs.appendFileSync(process.argv[1],JSON.stringify(p)+'\\n');if(p.hookName==='tool_call'){process.stdout.write(JSON.stringify({cancel:true,context:'stop-now',overrideInput:{safe:true}}));}});";

		const hookControl = createSubprocessHooks({
			command: [process.execPath, "-e", script, output],
		});

		const control = await hookControl.hooks.onToolCallStart?.({
			agentId: "agent-main",
			conversationId: "conv-main",
			parentAgentId: null,
			iteration: 2,
			call: {
				id: "c-1",
				name: "bash",
				input: { command: "ls" },
			},
		});
		expect(control).toEqual({
			cancel: true,
			context: "stop-now",
			overrideInput: { safe: true },
		});

		await expect(
			hookControl.hooks.onToolCallEnd?.({
				agentId: "agent-main",
				conversationId: "conv-main",
				parentAgentId: null,
				iteration: 2,
				record: {
					id: "c-1",
					name: "bash",
					input: { command: "ls" },
					output: "ok",
					durationMs: 1,
					startedAt: new Date(),
					endedAt: new Date(),
				},
			}),
		).resolves.toBeUndefined();
		await expect(
			hookControl.hooks.onTurnEnd?.({
				agentId: "agent-main",
				conversationId: "conv-main",
				parentAgentId: null,
				iteration: 2,
				turn: {
					text: "done",
					toolCalls: [],
					invalidToolCalls: [],
					usage: { inputTokens: 1, outputTokens: 1 },
					truncated: false,
				},
			}),
		).resolves.toBeUndefined();
		await expect(
			hookControl.hooks.onStopError?.({
				agentId: "agent-main",
				conversationId: "conv-main",
				parentAgentId: null,
				iteration: 2,
				error: new Error("rate limited"),
			}),
		).resolves.toBeUndefined();
		await expect(
			hookControl.shutdown({
				agentId: "agent-main",
				conversationId: "conv-main",
				parentAgentId: null,
				reason: "test",
			}),
		).resolves.toBeUndefined();

		const contents = await waitForFileContents(output, (text) =>
			text.includes('"hookName":"agent_error"'),
		);
		const lines = contents
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));

		expect(lines.some((e) => e.hookName === "tool_call")).toBe(true);
		expect(
			lines.some(
				(e) =>
					e.hookName === "agent_error" && e.error?.message === "rate limited",
			),
		).toBe(true);
	});

	it("reports dispatch errors without throwing", async () => {
		const onDispatchError = vi
			.fn<(error: Error) => void>()
			.mockImplementation(() => undefined);

		const hookControl = createSubprocessHooks({
			command: ["/path/does/not/exist"],
			onDispatchError: (error) => onDispatchError(error),
		});

		await expect(
			hookControl.hooks.onToolCallEnd?.({
				agentId: "agent-main",
				conversationId: "conv-main",
				parentAgentId: null,
				iteration: 2,
				record: {
					id: "c-1",
					name: "bash",
					input: { command: "ls" },
					output: "ok",
					durationMs: 1,
					startedAt: new Date(),
					endedAt: new Date(),
				},
			}),
		).resolves.toBeUndefined();

		await waitFor(
			async () => onDispatchError.mock.calls.length,
			(callCount) => callCount > 0,
		);
		expect(onDispatchError).toHaveBeenCalled();
	});

	it("treats invalid tool_call stdout as dispatch error", async () => {
		const onDispatchError = vi.fn<(error: Error) => void>();
		const hookControl = createSubprocessHooks({
			command: [process.execPath, "-e", "process.stdout.write('not-json')"],
			onDispatchError: (error) => onDispatchError(error),
		});

		const result = await hookControl.hooks.onToolCallStart?.({
			agentId: "agent-main",
			conversationId: "conv-main",
			parentAgentId: null,
			iteration: 1,
			call: {
				id: "c-1",
				name: "bash",
				input: { command: "ls" },
			},
		});

		expect(result).toBeUndefined();
		expect(onDispatchError).toHaveBeenCalledTimes(1);
	});
});
