import { describe, expect, it } from "vitest";
import { createBashExecutor, createWindowsExecutor } from "./bash.js";
import type { ToolContext } from "@clinebot/shared";

const ctx: ToolContext = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

describe("createBashExecutor", () => {
	it("runs a simple command and returns stdout", async () => {
		const bash = createBashExecutor();
		const output = await bash("echo hello", process.cwd(), ctx);
		expect(output.trim()).toBe("hello");
	});

	it("rejects on non-zero exit code", async () => {
		const bash = createBashExecutor();
		await expect(bash("exit 1", process.cwd(), ctx)).rejects.toThrow();
	});

	it("includes stderr in combined output on success", async () => {
		const bash = createBashExecutor({ combineOutput: true });
		const output = await bash("echo ok && echo warn >&2", process.cwd(), ctx);
		expect(output).toContain("ok");
		expect(output).toContain("[stderr]");
		expect(output).toContain("warn");
	});

	it("excludes stderr when combineOutput is false", async () => {
		const bash = createBashExecutor({ combineOutput: false });
		const output = await bash("echo ok && echo warn >&2", process.cwd(), ctx);
		expect(output.trim()).toBe("ok");
	});

	it("rejects on timeout", async () => {
		const bash = createBashExecutor({ timeoutMs: 50 });
		await expect(
			bash("sleep 10", process.cwd(), ctx),
		).rejects.toThrow("timed out");
	});

	it("truncates output exceeding maxOutputBytes", async () => {
		const bash = createBashExecutor({ maxOutputBytes: 10 });
		const output = await bash(
			`${process.execPath} -e "process.stdout.write('a'.repeat(100))"`,
			process.cwd(),
			ctx,
		);
		expect(output).toContain("[Output truncated:");
	});

	it("rejects when abort signal fires", async () => {
		const ac = new AbortController();
		const abortCtx: ToolContext = { ...ctx, abortSignal: ac.signal };
		const bash = createBashExecutor();

		setTimeout(() => ac.abort(), 50);
		await expect(
			bash("sleep 10", process.cwd(), abortCtx),
		).rejects.toThrow("aborted");
	});
});

describe("createWindowsExecutor", () => {
	it("runs structured commands without shell parsing", async () => {
		const executor = createWindowsExecutor();
		const output = await executor(
			{
				command: process.execPath,
				args: ["-e", "process.stdout.write(process.argv[1])", "argv-ok"],
			},
			process.cwd(),
			ctx,
		);
		expect(output).toBe("argv-ok");
	});

	it("runs string commands through the shell", async () => {
		const executor = createWindowsExecutor();
		const output = await executor("echo shell-ok", process.cwd(), ctx);
		expect(output.trim()).toBe("shell-ok");
	});
});
