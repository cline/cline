import { spawnSync } from "node:child_process";
import {
	access,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CommandExitError,
	cleanupStaleDetachedCommandLogs,
	createShellExecutor,
} from "./bash";
import { RunCommandExecutionController } from "./run-command-execution-controller";

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

function detachedCommandMarker(
	pid: number,
	processStartToken: string,
	hardKillAtMs?: number,
): string {
	return `${JSON.stringify({
		version: 1,
		executionId: `execution-${pid}`,
		pid,
		processStartToken,
		detachedAtMs: Date.now(),
		...(hardKillAtMs !== undefined ? { hardKillAtMs } : {}),
	})}\n`;
}

describe("createShellExecutor", () => {
	it("runs a simple command and returns stdout", async () => {
		const shell = createShellExecutor();
		const output = await shell("echo hello", process.cwd(), ctx);
		expect(output.trim()).toBe("hello");
	});

	it("streams stdout and stderr with ANSI escapes before completion", async () => {
		const updates: Array<Record<string, unknown>> = [];
		let resolveBothStreams: (() => void) | undefined;
		const bothStreams = new Promise<void>((resolve) => {
			resolveBothStreams = resolve;
		});
		let completed = false;
		const shell = createShellExecutor({ timeoutMs: 2_000 });
		const execution = shell(
			{
				command: process.execPath,
				args: [
					"-e",
					"process.stdout.write('\\u001b[31mred\\u001b[0m'); process.stderr.write('\\u001b[33mwarn\\u001b[0m'); setTimeout(() => {}, 150)",
				],
			},
			process.cwd(),
			{
				...ctx,
				emitUpdate: (update) => {
					updates.push(update as Record<string, unknown>);
					const chunks = updates.filter(
						(item) => typeof item.chunk === "string" && item.chunk.length > 0,
					);
					if (
						chunks.some((item) => item.stream === "stdout") &&
						chunks.some((item) => item.stream === "stderr")
					) {
						resolveBothStreams?.();
					}
				},
			},
		).finally(() => {
			completed = true;
		});

		await bothStreams;
		expect(completed).toBe(false);
		expect(updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					stream: "stdout",
					chunk: "\u001b[31mred\u001b[0m",
				}),
				expect.objectContaining({
					stream: "stderr",
					chunk: "\u001b[33mwarn\u001b[0m",
				}),
			]),
		);
		await execution;
	});

	it("coalesces and bounds progress queued by noisy commands", async () => {
		const updates: Array<Record<string, unknown>> = [];
		const shell = createShellExecutor({
			timeoutMs: 2_000,
			maxOutputChars: 128,
		});

		await shell(
			{
				command: process.execPath,
				args: [
					"-e",
					"for (let i = 0; i < 2_000; i++) process.stdout.write('0123456789'); setTimeout(() => {}, 100)",
				],
			},
			process.cwd(),
			{
				...ctx,
				emitUpdate: (update) => updates.push(update as Record<string, unknown>),
			},
		);

		const chunks = updates.filter(
			(update) => typeof update.chunk === "string" && update.chunk.length > 0,
		);
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks.length).toBeLessThanOrEqual(3);
		expect(chunks.every((update) => String(update.chunk).length <= 128)).toBe(
			true,
		);
		expect(chunks.some((update) => update.truncated === true)).toBe(true);
		expect(chunks.at(-1)?.chunk).toContain("0123456789");
	});

	it("releases a detachable command while it continues in the background", async () => {
		const controller = new RunCommandExecutionController();
		let commandStarted = false;
		let detachReady = false;
		const detachabilityUpdates: boolean[] = [];
		let resolveDetachReady: (() => void) | undefined;
		const readyToDetach = new Promise<void>((resolve) => {
			resolveDetachReady = resolve;
		});
		const resolveWhenReady = () => {
			if (commandStarted && detachReady) resolveDetachReady?.();
		};
		const shell = createShellExecutor({
			timeoutMs: 2_000,
			executionController: controller,
			detachedLogRetentionMs: 250,
			processStartTokenProbe: (pid) => ({
				status: "found",
				token: `test-process-${pid}`,
			}),
		});
		const execution = shell(
			{
				command: process.execPath,
				args: [
					"-e",
					"process.stdout.write('started:' + process.pid + '\\n'); setTimeout(() => process.stdout.write('finished\\n'), 300)",
				],
			},
			process.cwd(),
			{
				...ctx,
				sessionId: "session-detach",
				toolCallId: "call-detach",
				emitUpdate: (update) => {
					const payload = update as Record<string, unknown>;
					if (typeof payload.detachable === "boolean") {
						detachabilityUpdates.push(payload.detachable);
					}
					if (
						typeof payload.chunk === "string" &&
						payload.chunk.startsWith("started:")
					) {
						commandStarted = true;
					}
					if (payload.detachable === true) detachReady = true;
					resolveWhenReady();
				},
			},
		);

		await readyToDetach;
		expect(detachabilityUpdates[0]).toBe(false);
		expect(detachabilityUpdates).toContain(true);
		expect(controller.proceedWhileRunning("session-detach", "other-call")).toBe(
			0,
		);
		expect(
			controller.proceedWhileRunning("session-detach", "call-detach"),
		).toBe(1);
		const result = await execution;
		expect(result).toContain("Command is still running");
		expect(result).toContain("started");
		expect(result).toMatch(/cline-command-.*output\.log/);
		const logPath = result.match(/Output will continue in (.+)]/)?.[1];
		if (!logPath) throw new Error("Expected detached command log path");
		const commandPid = result.match(/started:(\d+)/)?.[1];
		if (!commandPid) throw new Error("Expected detached command pid");
		try {
			expect(await fileExists(dirname(logPath))).toBe(true);
			const activeCommand = JSON.parse(
				await readFile(join(dirname(logPath), "active-command.json"), "utf8"),
			) as Record<string, unknown>;
			expect(activeCommand).toEqual({
				version: 1,
				executionId: expect.any(String),
				pid: Number(commandPid),
				processStartToken: expect.any(String),
				detachedAtMs: expect.any(Number),
			});
			await new Promise((resolve) => setTimeout(resolve, 350));
			expect(await fileExists(logPath)).toBe(true);
			await expect.poll(() => fileExists(dirname(logPath))).toBe(false);
		} finally {
			await rm(dirname(logPath), { recursive: true, force: true });
		}
	});

	it("implicitly detaches at the soft deadline and reports natural completion", async () => {
		const controller = new RunCommandExecutionController();
		const updates: Array<Record<string, unknown>> = [];
		const completions: unknown[] = [];
		controller.subscribeToDetachedCommandCompleted((event) =>
			completions.push(event),
		);
		const shell = createShellExecutor({
			executionController: controller,
			detachedLogRetentionMs: 50,
			processStartTokenProbe: (pid) => ({
				status: "found",
				token: `test-${pid}`,
			}),
		});

		const result = await shell(
			{
				command: process.execPath,
				args: ["-e", "setTimeout(() => process.exit(0), 180)"],
			},
			process.cwd(),
			{
				...ctx,
				sessionId: "session-implicit",
				toolCallId: "call-implicit",
				emitUpdate: (update) => updates.push(update as Record<string, unknown>),
			},
			{ detachAfterMs: 50, killAfterMs: 1_000 },
		);

		expect(result).toContain("Command is still running");
		expect(updates).toContainEqual(
			expect.objectContaining({ detached: true, detachKind: "implicit" }),
		);
		await expect.poll(() => completions.length).toBe(1);
		expect(completions[0]).toMatchObject({
			sessionId: "session-implicit",
			toolCallId: "call-implicit",
			detachKind: "implicit",
			outcome: { kind: "exited", exitCode: 0 },
		});
	});

	it("implicitly detaches without a manual-detach controller", async () => {
		const updates: Array<Record<string, unknown>> = [];
		const shell = createShellExecutor({
			detachedLogRetentionMs: 50,
			processStartTokenProbe: (pid) => ({
				status: "found",
				token: `test-${pid}`,
			}),
		});

		const result = await shell(
			{
				command: process.execPath,
				args: ["-e", "setTimeout(() => process.exit(0), 180)"],
			},
			process.cwd(),
			{
				...ctx,
				emitUpdate: (update) => updates.push(update as Record<string, unknown>),
			},
			{ detachAfterMs: 50, killAfterMs: 1_000 },
		);

		expect(result).toContain("Command is still running");
		expect(updates).toContainEqual(
			expect.objectContaining({ detached: true, detachKind: "implicit" }),
		);
		expect(updates).not.toContainEqual(
			expect.objectContaining({ detachable: true }),
		);
	});

	it("uses executor limit options when invocation limits are omitted", async () => {
		const controller = new RunCommandExecutionController();
		const completions: unknown[] = [];
		controller.subscribeToDetachedCommandCompleted((event) =>
			completions.push(event),
		);
		const shell = createShellExecutor({
			detachAfterMs: 50,
			killAfterMs: 1_000,
			executionController: controller,
			detachedLogRetentionMs: 50,
			processStartTokenProbe: (pid) => ({
				status: "found",
				token: `test-${pid}`,
			}),
		});

		await expect(
			shell(
				{
					command: process.execPath,
					args: ["-e", "setTimeout(() => process.exit(0), 180)"],
				},
				process.cwd(),
				{ ...ctx, sessionId: "session-options" },
			),
		).resolves.toContain("Command is still running");
		await expect.poll(() => completions.length).toBe(1);
		expect(completions[0]).toMatchObject({ detachKind: "implicit" });
	});

	it("keeps the hard deadline after implicit detach", async () => {
		const controller = new RunCommandExecutionController();
		const completions: unknown[] = [];
		controller.subscribeToDetachedCommandCompleted((event) =>
			completions.push(event),
		);
		const shell = createShellExecutor({
			executionController: controller,
			detachedLogRetentionMs: 50,
			processStartTokenProbe: (pid) => ({
				status: "found",
				token: `test-${pid}`,
			}),
		});

		await expect(
			shell(
				longRunningCommand,
				process.cwd(),
				{
					...ctx,
					sessionId: "session-hard-kill",
				},
				{ detachAfterMs: 50, killAfterMs: 180 },
			),
		).resolves.toContain("Command is still running");

		await expect.poll(() => completions.length).toBe(1);
		expect(completions[0]).toMatchObject({
			detachKind: "implicit",
			outcome: { kind: "hard_killed" },
		});
	});

	it("cancels the hard deadline after user detach", async () => {
		const controller = new RunCommandExecutionController();
		const completions: unknown[] = [];
		controller.subscribeToDetachedCommandCompleted((event) =>
			completions.push(event),
		);
		const shell = createShellExecutor({
			executionController: controller,
			detachedLogRetentionMs: 50,
			processStartTokenProbe: (pid) => ({
				status: "found",
				token: `test-${pid}`,
			}),
		});
		const execution = shell(
			{
				command: process.execPath,
				args: ["-e", "setTimeout(() => process.exit(0), 300)"],
			},
			process.cwd(),
			{ ...ctx, sessionId: "session-user" },
			{ detachAfterMs: Number.POSITIVE_INFINITY, killAfterMs: 150 },
		);

		await expect
			.poll(() => controller.proceedWhileRunning("session-user"))
			.toBe(1);
		await expect(execution).resolves.toContain("Command is still running");
		await expect.poll(() => completions.length).toBe(1);
		expect(completions[0]).toMatchObject({
			detachKind: "user",
			outcome: { kind: "exited", exitCode: 0 },
		});
	});

	it("does not arm soft detach when the hard deadline is not later", async () => {
		const controller = new RunCommandExecutionController();
		const updates: Array<Record<string, unknown>> = [];
		const shell = createShellExecutor({
			executionController: controller,
			processStartTokenProbe: (pid) => ({
				status: "found",
				token: `test-${pid}`,
			}),
		});

		await expect(
			shell(
				longRunningCommand,
				process.cwd(),
				{
					...ctx,
					sessionId: "session-ordering",
					emitUpdate: (update) =>
						updates.push(update as Record<string, unknown>),
				},
				{ detachAfterMs: 150, killAfterMs: 50 },
			),
		).rejects.toThrow("timed out");
		expect(updates.some((update) => update.detached === true)).toBe(false);
	});

	it("does not advertise detachment when process identity cannot be captured", async () => {
		const controller = new RunCommandExecutionController();
		const detachabilityUpdates: boolean[] = [];
		const shell = createShellExecutor({
			executionController: controller,
			processStartTokenProbe: async () => {
				throw new Error("identity unavailable");
			},
		});

		await expect(
			shell(
				{
					command: process.execPath,
					args: ["-e", "process.stdout.write('done')"],
				},
				process.cwd(),
				{
					...ctx,
					sessionId: "session-no-identity",
					emitUpdate: (update) => {
						const detachable = (update as Record<string, unknown>).detachable;
						if (typeof detachable === "boolean") {
							detachabilityUpdates.push(detachable);
						}
					},
				},
			),
		).resolves.toBe("done");
		expect(detachabilityUpdates).not.toContain(true);
		expect(controller.proceedWhileRunning("session-no-identity")).toBe(0);
	});

	it("reaps stale detached logs left by a previous Hub process", async () => {
		const tempDirectory = await mkdtemp(
			join(tmpdir(), "detached-log-cleanup-"),
		);
		const staleDirectory = join(tempDirectory, "cline-command-stale");
		const freshDirectory = join(tempDirectory, "cline-command-fresh");
		const unrelatedDirectory = join(tempDirectory, "other-command-log");
		try {
			const nowMs = Date.now();
			await Promise.all(
				[staleDirectory, freshDirectory, unrelatedDirectory].map((directory) =>
					mkdir(directory),
				),
			);
			const staleLog = join(staleDirectory, "output.log");
			const freshLog = join(freshDirectory, "output.log");
			await Promise.all([
				writeFile(staleLog, "stale"),
				writeFile(freshLog, "fresh"),
			]);
			await Promise.all([
				utimes(staleLog, new Date(nowMs - 1_000), new Date(nowMs - 1_000)),
				utimes(freshLog, new Date(nowMs - 50), new Date(nowMs - 50)),
			]);

			await expect(
				cleanupStaleDetachedCommandLogs({
					tempDirectory,
					retentionMs: 250,
					nowMs,
				}),
			).resolves.toBe(1);
			expect(await fileExists(staleDirectory)).toBe(false);
			expect(await fileExists(freshDirectory)).toBe(true);
			expect(await fileExists(unrelatedDirectory)).toBe(true);
			await expect.poll(() => fileExists(freshDirectory)).toBe(false);
		} finally {
			await rm(tempDirectory, { recursive: true, force: true });
		}
	});

	it("tracks the detached command across host restarts until it exits", async () => {
		const tempDirectory = await mkdtemp(
			join(tmpdir(), "detached-log-command-cleanup-"),
		);
		const liveDirectory = join(tempDirectory, "cline-command-live");
		const completedDirectory = join(tempDirectory, "cline-command-completed");
		let liveCommandExists = true;
		try {
			await Promise.all([mkdir(liveDirectory), mkdir(completedDirectory)]);
			await Promise.all([
				writeFile(join(liveDirectory, "output.log"), "silent but running"),
				writeFile(
					join(liveDirectory, "active-command.json"),
					detachedCommandMarker(101, "process-101"),
				),
				writeFile(join(completedDirectory, "output.log"), "completed"),
				writeFile(
					join(completedDirectory, "active-command.json"),
					detachedCommandMarker(202, "process-202"),
				),
			]);

			await expect(
				cleanupStaleDetachedCommandLogs({
					activeCommandPollIntervalMs: 20,
					tempDirectory,
					retentionMs: 250,
					nowMs: Date.now(),
					processStartTokenProbe: (pid) =>
						pid === 101 && liveCommandExists
							? { status: "found", token: "process-101" }
							: { status: "missing" },
				}),
			).resolves.toBe(0);
			expect(await fileExists(liveDirectory)).toBe(true);
			expect(await fileExists(join(liveDirectory, "active-command.json"))).toBe(
				true,
			);
			expect(await fileExists(completedDirectory)).toBe(true);
			expect(
				await fileExists(join(completedDirectory, "active-command.json")),
			).toBe(false);
			expect(await fileExists(join(completedDirectory, "completed-at"))).toBe(
				true,
			);
			await expect.poll(() => fileExists(completedDirectory)).toBe(false);
			expect(await fileExists(liveDirectory)).toBe(true);

			liveCommandExists = false;
			await expect
				.poll(() => fileExists(join(liveDirectory, "active-command.json")))
				.toBe(false);
			expect(await fileExists(join(liveDirectory, "completed-at"))).toBe(true);
			await expect.poll(() => fileExists(liveDirectory)).toBe(false);
		} finally {
			await rm(tempDirectory, { recursive: true, force: true });
		}
	});

	it("does not treat a reused PID as the detached command", async () => {
		const tempDirectory = await mkdtemp(
			join(tmpdir(), "detached-log-pid-reuse-"),
		);
		const reusedPidDirectory = join(tempDirectory, "cline-command-reused-pid");
		try {
			await mkdir(reusedPidDirectory);
			await Promise.all([
				writeFile(join(reusedPidDirectory, "output.log"), "old command"),
				writeFile(
					join(reusedPidDirectory, "active-command.json"),
					detachedCommandMarker(303, "original-process"),
				),
			]);

			await expect(
				cleanupStaleDetachedCommandLogs({
					tempDirectory,
					retentionMs: 100,
					nowMs: Date.now(),
					processStartTokenProbe: (pid) =>
						pid === 303
							? { status: "found", token: "replacement-process" }
							: { status: "missing" },
				}),
			).resolves.toBe(0);
			expect(await fileExists(reusedPidDirectory)).toBe(true);
			expect(
				await fileExists(join(reusedPidDirectory, "active-command.json")),
			).toBe(false);
			expect(await fileExists(join(reusedPidDirectory, "completed-at"))).toBe(
				true,
			);
			await expect.poll(() => fileExists(reusedPidDirectory)).toBe(false);
		} finally {
			await rm(tempDirectory, { recursive: true, force: true });
		}
	});

	it("enforces a persisted hard deadline after host restart", async () => {
		const tempDirectory = await mkdtemp(
			join(tmpdir(), "detached-log-hard-deadline-"),
		);
		const directory = join(tempDirectory, "cline-command-hard-deadline");
		const killProcessTree = vi.fn(async () => {});
		try {
			await mkdir(directory);
			await Promise.all([
				writeFile(join(directory, "output.log"), "still running"),
				writeFile(
					join(directory, "active-command.json"),
					detachedCommandMarker(505, "process-505", 900),
				),
			]);

			await cleanupStaleDetachedCommandLogs({
				tempDirectory,
				nowMs: 1_000,
				activeCommandPollIntervalMs: 60_000,
				processStartTokenProbe: () => ({
					status: "found",
					token: "process-505",
				}),
				killProcessTree,
			});

			expect(killProcessTree).toHaveBeenCalledWith(505);
			expect(await readFile(join(directory, "output.log"), "utf8")).toContain(
				"hard deadline",
			);
		} finally {
			await rm(tempDirectory, { recursive: true, force: true });
		}
	});

	it("preserves a live log through an identity probe failure", async () => {
		const tempDirectory = await mkdtemp(
			join(tmpdir(), "detached-log-probe-recovery-"),
		);
		const directory = join(tempDirectory, "cline-command-probe-recovery");
		let probeAvailable = false;
		try {
			await mkdir(directory);
			await Promise.all([
				writeFile(join(directory, "output.log"), "still running"),
				writeFile(
					join(directory, "active-command.json"),
					detachedCommandMarker(404, "process-404"),
				),
			]);
			const cleanupOptions = {
				activeCommandPollIntervalMs: 60_000,
				processStartTokenProbe: () =>
					probeAvailable
						? ({ status: "found", token: "process-404" } as const)
						: ({ status: "unavailable" } as const),
				retentionMs: 100,
				tempDirectory,
			};

			await expect(
				cleanupStaleDetachedCommandLogs({
					...cleanupOptions,
					nowMs: 1_000,
				}),
			).resolves.toBe(0);
			expect(await fileExists(join(directory, "completed-at"))).toBe(false);
			expect(await fileExists(join(directory, "active-command.json"))).toBe(
				true,
			);

			probeAvailable = true;
			await expect(
				cleanupStaleDetachedCommandLogs({
					...cleanupOptions,
					nowMs: 1_050,
				}),
			).resolves.toBe(0);
			expect(await fileExists(join(directory, "active-command.json"))).toBe(
				true,
			);
			expect(await fileExists(join(directory, "completed-at"))).toBe(false);
		} finally {
			await rm(tempDirectory, { recursive: true, force: true });
		}
	});

	it("never retires a live log while identity probing stays unavailable", async () => {
		const tempDirectory = await mkdtemp(
			join(tmpdir(), "detached-log-probe-timeout-"),
		);
		const directory = join(tempDirectory, "cline-command-probe-timeout");
		let probeStatus: "unavailable" | "missing" = "unavailable";
		const cleanupOptions = {
			activeCommandPollIntervalMs: 60_000,
			processStartTokenProbe: () => ({ status: probeStatus }),
			retentionMs: 0,
			tempDirectory,
		};
		try {
			await mkdir(directory);
			const markerText = detachedCommandMarker(505, "process-505");
			await Promise.all([
				writeFile(join(directory, "output.log"), "unverifiable command"),
				writeFile(join(directory, "active-command.json"), markerText),
			]);

			await expect(
				cleanupStaleDetachedCommandLogs({
					...cleanupOptions,
					nowMs: 2_000,
				}),
			).resolves.toBe(0);
			expect(await fileExists(join(directory, "active-command.json"))).toBe(
				true,
			);

			await expect(
				cleanupStaleDetachedCommandLogs({
					...cleanupOptions,
					nowMs: 7 * 24 * 60 * 60 * 1_000,
				}),
			).resolves.toBe(0);
			expect(await fileExists(join(directory, "active-command.json"))).toBe(
				true,
			);
			expect(await fileExists(join(directory, "completed-at"))).toBe(false);
			expect(await fileExists(directory)).toBe(true);
			expect(
				await readFile(join(directory, "active-command.json"), "utf8"),
			).toBe(markerText);

			probeStatus = "missing";
			await expect(
				cleanupStaleDetachedCommandLogs({
					...cleanupOptions,
					nowMs: 7 * 24 * 60 * 60 * 1_000 + 1,
				}),
			).resolves.toBe(1);
			expect(await fileExists(join(directory, "active-command.json"))).toBe(
				false,
			);
			expect(await fileExists(directory)).toBe(false);
		} finally {
			await rm(tempDirectory, { recursive: true, force: true });
		}
	});

	it("retries when an identity probe rejects", async () => {
		const tempDirectory = await mkdtemp(
			join(tmpdir(), "detached-log-probe-rejection-"),
		);
		const directory = join(tempDirectory, "cline-command-probe-rejection");
		let probeAttempts = 0;
		try {
			await mkdir(directory);
			await Promise.all([
				writeFile(join(directory, "output.log"), "still running"),
				writeFile(
					join(directory, "active-command.json"),
					detachedCommandMarker(606, "process-606"),
				),
			]);

			await expect(
				cleanupStaleDetachedCommandLogs({
					activeCommandPollIntervalMs: 25,
					nowMs: Date.now(),
					processStartTokenProbe: () => {
						probeAttempts += 1;
						if (probeAttempts === 1) {
							throw new Error("identity provider failed");
						}
						return { status: "missing" };
					},
					retentionMs: 60_000,
					tempDirectory,
				}),
			).resolves.toBe(0);
			expect(await fileExists(join(directory, "active-command.json"))).toBe(
				true,
			);
			expect(await fileExists(join(directory, "completed-at"))).toBe(false);

			await expect.poll(() => probeAttempts).toBeGreaterThanOrEqual(2);
			await expect
				.poll(() => fileExists(join(directory, "active-command.json")))
				.toBe(false);
			expect(await fileExists(join(directory, "completed-at"))).toBe(true);
		} finally {
			await rm(tempDirectory, { recursive: true, force: true });
		}
	});

	it("honors completion written before a leftover active marker", async () => {
		const tempDirectory = await mkdtemp(
			join(tmpdir(), "detached-log-completion-race-"),
		);
		const directory = join(tempDirectory, "cline-command-completion-race");
		const completedAtMs = Date.now() - 1_000;
		let processProbeCount = 0;
		try {
			await mkdir(directory);
			await Promise.all([
				writeFile(join(directory, "output.log"), "completed"),
				writeFile(
					join(directory, "active-command.json"),
					detachedCommandMarker(606, "process-606"),
				),
				writeFile(join(directory, "completed-at"), String(completedAtMs)),
			]);

			await expect(
				cleanupStaleDetachedCommandLogs({
					tempDirectory,
					retentionMs: 500,
					nowMs: Date.now(),
					processStartTokenProbe: () => {
						processProbeCount += 1;
						return { status: "found", token: "process-606" };
					},
				}),
			).resolves.toBe(1);
			expect(processProbeCount).toBe(0);
			expect(await fileExists(directory)).toBe(false);
		} finally {
			await rm(tempDirectory, { recursive: true, force: true });
		}
	});

	it("runs an object-form command with no args as a shell command line", async () => {
		// Models emit e.g. { command: "echo hello" } — a full command line in
		// the object form. Spawning it verbatim fails with ENOENT; it must be
		// routed through the shell like the string form.
		const shell = createShellExecutor();
		const output = await shell({ command: "echo hello" }, process.cwd(), ctx);
		expect(output.trim()).toBe("hello");
	});

	it("keeps an object-form command with an explicit empty args array as direct exec", async () => {
		const shell = createShellExecutor();
		// An args key, even empty, marks structured input: the command is
		// spawned verbatim rather than reinterpreted as a shell line, so a
		// spaced command string fails instead of being split by the shell.
		await expect(
			shell({ command: "echo hello", args: [] }, process.cwd(), ctx),
		).rejects.toThrow("Failed to execute command");
	});

	it("execs an object-form command with args directly without shell parsing", async () => {
		const shell = createShellExecutor();
		// The shell-metachar argument arrives verbatim, proving the argv is
		// passed straight to the executable rather than re-parsed by a shell.
		const output = await shell(
			{
				command: process.execPath,
				args: ["-e", "process.stdout.write(process.argv[1])", "argv $HOME ok"],
			},
			process.cwd(),
			ctx,
		);
		expect(output).toBe("argv $HOME ok");
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
	const hasPwsh =
		spawnSync("where.exe", ["pwsh.exe"], {
			stdio: "ignore",
			windowsHide: true,
		}).status === 0;
	for (const shell of ["powershell.exe", "pwsh.exe"]) {
		it.runIf(shell === "powershell.exe" || hasPwsh)(
			`preserves Unicode through ${shell} command input and output`,
			async () => {
				const executor = createShellExecutor({ shell });
				const output = await executor(
					"Write-Output '中文'",
					process.cwd(),
					ctx,
				);
				expect(output.trim()).toBe("中文");
			},
		);

		it.runIf(shell === "powershell.exe" || hasPwsh)(
			`reports a failed final native command through ${shell}`,
			async () => {
				const executor = createShellExecutor({ shell });
				let error: unknown;
				try {
					await executor("cmd /c exit 5", process.cwd(), ctx);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(CommandExitError);
				// Direct PowerShell -Command normalizes a failed final command to 1.
				expect((error as CommandExitError).exitCode).toBe(1);
			},
		);

		it.runIf(shell === "powershell.exe" || hasPwsh)(
			`reports a PowerShell failure after a native command through ${shell}`,
			async () => {
				const executor = createShellExecutor({ shell });
				let error: unknown;
				try {
					await executor("cmd /c exit 5; Write-Error boom", process.cwd(), ctx);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(CommandExitError);
				expect((error as CommandExitError).exitCode).toBe(1);
			},
		);

		it.runIf(shell === "powershell.exe" || hasPwsh)(
			`preserves an explicit exit code through ${shell}`,
			async () => {
				const executor = createShellExecutor({ shell });
				let error: unknown;
				try {
					await executor("exit 7", process.cwd(), ctx);
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(CommandExitError);
				expect((error as CommandExitError).exitCode).toBe(7);
			},
		);
	}

	it("runs PowerShell commands beyond the Windows command-line limit", async () => {
		const executor = createShellExecutor();
		const payload = "x".repeat(40_000);
		const output = await executor(
			`Write-Output '${payload.length}'; $null = '${payload}'`,
			process.cwd(),
			ctx,
		);
		expect(output.trim()).toBe("40000");
	});

	it("rejects safely when PowerShell exits without reading command input", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "shell-stdin-error-"));
		const fakePowerShell = join(tempDir, "pwsh.exe");
		try {
			await copyFile(process.execPath, fakePowerShell);
			const executor = createShellExecutor({ shell: fakePowerShell });
			await expect(
				executor(`Write-Output '${"x".repeat(5_000_000)}'`, process.cwd(), ctx),
			).rejects.toThrow();
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

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
