import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext } from "@cline/shared";
import * as iconv from "iconv-lite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CommandExitError,
	createRollingCollector,
	createShellExecutor,
	parseWindowsCodePage,
} from "./bash";

const childProcessMocks = vi.hoisted(() => ({
	execFileSync: vi.fn(),
	spawn: vi.fn(),
	actualExecFileSync: undefined as
		| typeof import("node:child_process").execFileSync
		| undefined,
	actualSpawn: undefined as
		| typeof import("node:child_process").spawn
		| undefined,
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	childProcessMocks.actualExecFileSync = actual.execFileSync;
	childProcessMocks.actualSpawn = actual.spawn;
	childProcessMocks.execFileSync.mockImplementation(actual.execFileSync);
	childProcessMocks.spawn.mockImplementation(actual.spawn);
	return {
		...actual,
		execFileSync: childProcessMocks.execFileSync,
		spawn: childProcessMocks.spawn,
	};
});

const ctx: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

const longRunningCommand = {
	command: process.execPath,
	args: ["-e", "setInterval(() => {}, 1_000)"],
};

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
afterEach(() => {
	vi.restoreAllMocks();
	childProcessMocks.execFileSync.mockReset();
	childProcessMocks.spawn.mockReset();
	if (!childProcessMocks.actualExecFileSync || !childProcessMocks.actualSpawn) {
		throw new Error("child_process mocks were not initialized");
	}
	childProcessMocks.execFileSync.mockImplementation(
		childProcessMocks.actualExecFileSync,
	);
	childProcessMocks.spawn.mockImplementation(childProcessMocks.actualSpawn);
});

describe("createShellExecutor", () => {
	it("decodes the issue literal from split GBK bytes", () => {
		const expected = readFileSync(
			new URL("./__fixtures__/issue-10378-repro.txt", import.meta.url),
			"utf8",
		);
		const bytes = Buffer.from(expected, "utf8");
		const gbkBytes = Buffer.from(iconv.encode(expected, "gbk"));
		const collector = createRollingCollector(1000, "gbk");
		for (const byte of gbkBytes) collector.append(Buffer.from([byte]));
		const utf8Text = new TextDecoder().decode(gbkBytes);

		expect(utf8Text).not.toBe(expected);
		expect(collector.snapshot().text).toBe(expected);
		expect(bytes.length).toBeGreaterThan(0);
	});

	it("parses localized code-page output and falls back on malformed output", () => {
		expect(parseWindowsCodePage("Aktive Codepage: 936\r\n")).toBe(936);
		expect(parseWindowsCodePage("代码页: 950\n")).toBe(950);
		expect(parseWindowsCodePage("not available")).toBe(65001);
	});

	it("keeps stdout and stderr decoder state independent", () => {
		const stdout = createRollingCollector(1000, "big5");
		const stderr = createRollingCollector(1000, "big5");
		const stdoutBytes = iconv.encode("输出", "big5");
		const stderrBytes = iconv.encode("錯誤", "big5");
		stdout.append(stdoutBytes.subarray(0, 1));
		stderr.append(stderrBytes.subarray(0, 1));
		stdout.append(stdoutBytes.subarray(1));
		stderr.append(stderrBytes.subarray(1));
		expect(stdout.snapshot().text).toBe("输出");
		expect(stderr.snapshot().text).toBe("錯誤");
	});

	it("decodes representative OEM and ANSI single-byte encodings", () => {
		const cases = [
			["cp437", "Café"],
			["cp850", "Çafé"],
			["cp866", "Привет"],
			["windows1252", "Café €"],
		] as const;

		for (const [encoding, expected] of cases) {
			const collector = createRollingCollector(1000, encoding);
			collector.append(iconv.encode(expected, encoding));
			expect(collector.snapshot().text).toBe(expected);
		}
	});

	it("preserves valid UTF-8 output under a single-byte code page", () => {
		const expected = "native UTF-8 output: café ✓ └─";
		const collector = createRollingCollector(1000, "cp437");
		collector.append(Buffer.from(expected, "utf8"));
		expect(collector.snapshot().text).toBe(expected);
	});

	it.runIf(process.platform === "win32")(
		"re-resolves the configured shell code page for each command",
		async () => {
			const fixture = readFileSync(
				new URL("./__fixtures__/issue-10378-repro.txt", import.meta.url),
				"utf8",
			);
			const outputs = [
				iconv.encode(fixture, "gbk"),
				iconv.encode("輸出", "big5"),
			];
			const codePages = [
				"Active code page: 936\r\n",
				"Active code page: 950\r\n",
			];
			childProcessMocks.execFileSync.mockImplementation(() => {
				const codePage = codePages.shift();
				if (!codePage) throw new Error("unexpected code-page probe");
				return codePage;
			});
			childProcessMocks.spawn.mockImplementation(
				(() => {
					let call = 0;
					return () => {
						const stdout = new EventEmitter();
						const stderr = new EventEmitter();
						const child = new EventEmitter() as EventEmitter & {
							pid: number;
							stdout: EventEmitter;
							stderr: EventEmitter;
							kill: () => void;
						};
						child.pid = 100 + call;
						child.stdout = stdout;
						child.stderr = stderr;
						child.kill = () => {};
						const bytes = outputs[call++];
						queueMicrotask(() => {
							stdout.emit("data", Buffer.from(bytes));
							child.emit("close", 0);
						});
						return child as never;
					};
				})(),
			);

			const executor = createShellExecutor({ shell: "cmd.exe" });
			await expect(executor("echo first", process.cwd(), ctx)).resolves.toBe(
				fixture,
			);
			await expect(executor("echo second", process.cwd(), ctx)).resolves.toBe(
				"輸出",
			);
			expect(childProcessMocks.execFileSync).toHaveBeenCalledTimes(2);
			expect(childProcessMocks.execFileSync).toHaveBeenNthCalledWith(
				1,
				"cmd.exe",
				["/d", "/s", "/c", "chcp"],
				expect.objectContaining({ encoding: "utf8", windowsHide: true }),
			);
		},
	);

	it.runIf(process.platform === "win32")(
		"keeps structured executables on UTF-8 without probing shell state",
		async () => {
			childProcessMocks.spawn.mockImplementation(() => {
				const stdout = new EventEmitter();
				const stderr = new EventEmitter();
				const child = new EventEmitter() as EventEmitter & {
					pid: number;
					stdout: EventEmitter;
					stderr: EventEmitter;
					kill: () => void;
				};
				child.pid = 200;
				child.stdout = stdout;
				child.stderr = stderr;
				child.kill = () => {};
				queueMicrotask(() => {
					stdout.emit("data", Buffer.from("direct output"));
					child.emit("close", 0);
				});
				return child as never;
			});

			const executor = createShellExecutor();
			await expect(
				executor(
					{
						command: "powershell.exe",
						args: ["-NoProfile", "-Command", "Write-Output output"],
					},
					process.cwd(),
					ctx,
				),
			).resolves.toBe("direct output");
			expect(childProcessMocks.execFileSync).not.toHaveBeenCalled();
		},
	);

	it("runs a simple command and returns stdout", async () => {
		const shell = createShellExecutor();
		const output = await shell("echo hello", process.cwd(), ctx);
		expect(output.trim()).toBe("hello");
	});

	it("rejects on non-zero exit code", async () => {
		const shell = createShellExecutor();
		await expect(shell("exit 1", process.cwd(), ctx)).rejects.toThrow();
	});

	it("includes stdout and exit code on non-zero exit", async () => {
		const shell = createShellExecutor();
		let error: unknown;
		try {
			await shell(
				{
					command: process.execPath,
					args: [
						"-e",
						"process.stdout.write('failure details'); process.exit(1)",
					],
				},
				process.cwd(),
				ctx,
			);
		} catch (caught) {
			error = caught;
		}

		if (!(error instanceof CommandExitError)) {
			throw new Error("Expected CommandExitError");
		}
		expect(error.exitCode).toBe(1);
		expect(error.output).toContain("[Command exited with code 1]");
		expect(error.output).toContain("failure details");
	});

	it("excludes stderr on non-zero exit when combineOutput is false", async () => {
		const shell = createShellExecutor({ combineOutput: false });
		let error: unknown;
		try {
			await shell(
				{
					command: process.execPath,
					args: [
						"-e",
						"process.stdout.write('visible'); process.stderr.write('hidden'); process.exit(1)",
					],
				},
				process.cwd(),
				ctx,
			);
		} catch (caught) {
			error = caught;
		}

		if (!(error instanceof CommandExitError)) {
			throw new Error("Expected CommandExitError");
		}
		expect(error.output).toContain("visible");
		expect(error.output).not.toContain("[stderr]");
		expect(error.output).not.toContain("hidden");
	});

	it("includes stderr in combined output on success", async () => {
		const shell = createShellExecutor({ combineOutput: true });
		const output = await shell(
			{
				command: process.execPath,
				args: [
					"-e",
					"process.stdout.write('ok'); process.stderr.write('warn')",
				],
			},
			process.cwd(),
			ctx,
		);
		expect(output).toContain("ok");
		expect(output).toContain("[stderr]");
		expect(output).toContain("warn");
	});

	it("excludes stderr when combineOutput is false", async () => {
		const shell = createShellExecutor({ combineOutput: false });
		const output = await shell(
			{
				command: process.execPath,
				args: [
					"-e",
					"process.stdout.write('ok'); process.stderr.write('warn')",
				],
			},
			process.cwd(),
			ctx,
		);
		expect(output.trim()).toBe("ok");
	});

	it("rejects on timeout", async () => {
		const shell = createShellExecutor({ timeoutMs: 50 });
		await expect(shell(longRunningCommand, process.cwd(), ctx)).rejects.toThrow(
			"timed out",
		);
	});

	it("middle-truncates output exceeding maxOutputBytes, keeping head and tail", async () => {
		const shell = createShellExecutor({ maxOutputBytes: 20 });
		const output = await shell(
			{
				command: process.execPath,
				args: ["-e", "process.stdout.write('HEAD' + 'x'.repeat(100) + 'TAIL')"],
			},
			process.cwd(),
			ctx,
		);
		expect(output).toContain("HEAD");
		expect(output).toContain("TAIL");
		expect(output).toContain("[... output truncated: 108 chars total");
		expect(output.length).toBeLessThan(300);
	});

	it("keeps default-capped output bounded with the notice in the preserved head/tail", async () => {
		// Provider-request building (session/services/message-builder.ts)
		// may middle-cut long tool-result strings again with its own
		// backstop. The executor keeps its truncation notice in the head and
		// tail halves, so the recovery guidance survives any such cut.
		const shell = createShellExecutor();
		const output = await shell(
			{
				command: process.execPath,
				args: ["-e", "process.stdout.write('x'.repeat(60_000))"],
			},
			process.cwd(),
			ctx,
		);
		expect(output.length).toBeLessThanOrEqual(50_000);
		expect(output).toContain("output truncated: 60000 chars total");
	});

	it("does not truncate output within maxOutputBytes", async () => {
		const shell = createShellExecutor({ maxOutputBytes: 1000 });
		const payload = "b".repeat(500);
		const output = await shell(
			{
				command: process.execPath,
				args: ["-e", `process.stdout.write('${payload}')`],
			},
			process.cwd(),
			ctx,
		);
		expect(output).toBe(payload);
	});

	it("marks truncation in the captured output when a failing command floods stderr", async () => {
		const shell = createShellExecutor({ maxOutputBytes: 20 });
		let error: unknown;
		try {
			await shell(
				{
					command: process.execPath,
					args: [
						"-e",
						"process.stderr.write('ERR' + 'x'.repeat(100) + 'TAIL'); process.exit(1)",
					],
				},
				process.cwd(),
				ctx,
			);
		} catch (caught) {
			error = caught;
		}

		if (!(error instanceof CommandExitError)) {
			throw new Error("Expected CommandExitError");
		}
		expect(error.output).toContain("output truncated");
	});

	it("keeps the tail of streamed output written in many chunks", async () => {
		const shell = createShellExecutor({ maxOutputBytes: 40 });
		const output = await shell(
			{
				command: process.execPath,
				args: [
					"-e",
					"for (let i = 0; i < 50; i++) process.stdout.write('line' + i + '\\n'); process.stdout.write('FINAL')",
				],
			},
			process.cwd(),
			ctx,
		);
		expect(output).toContain("line0");
		expect(output).toContain("FINAL");
		expect(output).toContain("output truncated");
	});

	it("rejects when abort signal fires", async () => {
		const ac = new AbortController();
		const abortCtx: AgentToolContext = { ...ctx, signal: ac.signal };
		const shell = createShellExecutor();

		setTimeout(() => ac.abort(), 50);
		await expect(
			shell(longRunningCommand, process.cwd(), abortCtx),
		).rejects.toThrow("aborted");
	});

	it("does not spawn a command for an already-aborted signal", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "shell-pre-abort-"));
		const markerPath = join(tempDir, "spawned");
		const ac = new AbortController();
		ac.abort();
		const shell = createShellExecutor();
		try {
			await expect(
				shell(
					{
						command: process.execPath,
						args: [
							"-e",
							`require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "spawned")`,
						],
					},
					process.cwd(),
					{ ...ctx, signal: ac.signal },
				),
			).rejects.toThrow("aborted");
			expect(await fileExists(markerPath)).toBe(false);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it.runIf(process.platform === "win32")(
		"does not probe the code page for an already-aborted string command",
		async () => {
			const ac = new AbortController();
			ac.abort();
			const shell = createShellExecutor({ shell: "cmd.exe" });

			await expect(
				shell("echo never", process.cwd(), { ...ctx, signal: ac.signal }),
			).rejects.toThrow("aborted");
			expect(childProcessMocks.execFileSync).not.toHaveBeenCalled();
			expect(childProcessMocks.spawn).not.toHaveBeenCalled();
		},
	);

	it("finishes abort cleanup before a descendant can outlive the command", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "shell-abort-tree-"));
		const readyPath = join(tempDir, "ready");
		const descendantPath = join(tempDir, "descendant-survived");
		const ac = new AbortController();
		const shell = createShellExecutor();
		const descendantScript = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(descendantPath)}, "survived"), 1_000)`;
		const parentScript = [
			'const { spawn } = require("node:child_process")',
			'const { writeFileSync } = require("node:fs")',
			`spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}], { stdio: "ignore" })`,
			`writeFileSync(${JSON.stringify(readyPath)}, "ready")`,
			"setInterval(() => {}, 1_000)",
		].join(";");

		try {
			const execution = shell(
				{ command: process.execPath, args: ["-e", parentScript] },
				process.cwd(),
				{ ...ctx, signal: ac.signal },
			);
			await expect.poll(() => fileExists(readyPath)).toBe(true);
			ac.abort();
			await expect(execution).rejects.toThrow("aborted");
			await new Promise((resolve) => setTimeout(resolve, 1_200));
			expect(await fileExists(descendantPath)).toBe(false);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("flushes a trailing incomplete multibyte sequence instead of dropping it", async () => {
		const shell = createShellExecutor();
		// Output ends with the first byte of a two-byte UTF-8 sequence; the
		// decoder must flush it at end-of-stream (as U+FFFD) rather than
		// silently dropping buffered bytes.
		const output = await shell(
			{
				command: process.execPath,
				args: ["-e", "process.stdout.write(Buffer.from([0x61, 0x62, 0xc3]))"],
			},
			process.cwd(),
			ctx,
		);
		expect(output).toHaveLength(3);
		expect(output.startsWith("ab")).toBe(true);
	});

	it("honors maxOutputChars and the deprecated maxOutputBytes alias", async () => {
		const emit = {
			command: process.execPath,
			args: ["-e", "process.stdout.write('x'.repeat(500))"],
		};
		const renamed = await createShellExecutor({ maxOutputChars: 100 })(
			emit,
			process.cwd(),
			ctx,
		);
		const alias = await createShellExecutor({ maxOutputBytes: 100 })(
			emit,
			process.cwd(),
			ctx,
		);
		expect(renamed).toContain("output truncated: 500 chars total");
		expect(alias).toContain("output truncated: 500 chars total");
	});
});

describe.runIf(process.platform === "win32")("createWindowsExecutor", () => {
	it("runs structured commands without shell parsing", async () => {
		const executor = createShellExecutor();
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
		const executor = createShellExecutor();
		const output = await executor("echo shell-ok", process.cwd(), ctx);
		expect(output.trim()).toBe("shell-ok");
	});
});
