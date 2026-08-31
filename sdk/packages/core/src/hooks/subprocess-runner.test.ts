import { describe, expect, it, vi } from "vitest";
import { runSubprocessEvent } from "./subprocess-runner";

describe("runSubprocessEvent", () => {
	it("does not lose close events from children that exit while stdin is flushing", async () => {
		for (let iteration = 0; iteration < 20; iteration++) {
			const result = await runSubprocessEvent(
				{ payload: "x".repeat(64 * 1024) },
				{
					command: [process.execPath, "-e", "process.exit(0)"],
					timeoutMs: 2_000,
				},
			);
			expect(result?.exitCode).toBe(0);
		}
	});

	it("parses CRLF-delimited hook control output", async () => {
		const result = await runSubprocessEvent(
			{},
			{
				command: [
					process.execPath,
					"-e",
					`process.stdout.write('diagnostic\\r\\nHOOK_CONTROL\\t{"cancel":true}\\r\\n')`,
				],
				timeoutMs: 2_000,
			},
		);
		expect(result?.parsedJson).toEqual({ cancel: true });
	});

	it("times out a child across its entire lifecycle", async () => {
		const result = await runSubprocessEvent(
			{ payload: "x".repeat(64 * 1024) },
			{
				command: [process.execPath, "-e", "setInterval(() => {}, 1_000)"],
				timeoutMs: 50,
			},
		);
		expect(result?.timedOut).toBe(true);
	});

	it("reports a detached hook's runtime once it exits", async () => {
		const observed: Array<{ durationMs: number; exited: boolean }> = [];
		await runSubprocessEvent(
			{},
			{
				command: [process.execPath, "-e", "setTimeout(() => {}, 20)"],
				detached: true,
				detachedObservationMs: 5_000,
				onDetachedSettled: (event) => observed.push(event),
			},
		);
		await vi.waitFor(() => expect(observed).toHaveLength(1), {
			timeout: 5_000,
		});
		expect(observed[0].exited).toBe(true);
	});

	it("reports a censored observation for a detached hook that never exits", async () => {
		const observed: Array<{ durationMs: number; exited: boolean }> = [];
		await runSubprocessEvent(
			{},
			{
				command: [process.execPath, "-e", "setInterval(() => {}, 1_000)"],
				detached: true,
				detachedObservationMs: 100,
				onDetachedSettled: (event) => observed.push(event),
			},
		);
		// The hook is still running: without the censored observation this
		// sample would silently contain only hooks that finish.
		await vi.waitFor(() => expect(observed).toHaveLength(1), {
			timeout: 5_000,
		});
		expect(observed[0].exited).toBe(false);
		expect(observed[0].durationMs).toBeGreaterThanOrEqual(100);

		// Exactly one observation per hook, even after it is killed.
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(observed).toHaveLength(1);
	});

	it("settles after exit even when a spawned child keeps the stdio pipes open", async () => {
		// The hook exits immediately, but its detached-and-inheriting child
		// holds the stdout pipe open well past it — "close" alone would keep
		// the caller waiting on the grandchild.
		const script = [
			`const { spawn } = require("child_process");`,
			`const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], { stdio: ["ignore", "inherit", "ignore"], detached: true });`,
			`child.unref();`,
			`process.stdout.write('HOOK_CONTROL\\t{"cancel":false}\\n');`,
		].join("\n");
		const started = Date.now();
		const result = await runSubprocessEvent(
			{},
			{
				command: [process.execPath, "-e", script],
				timeoutMs: 10_000,
			},
		);
		expect(Date.now() - started).toBeLessThan(10_000);
		expect(result?.exitCode).toBe(0);
		expect(result?.parsedJson).toEqual({ cancel: false });
	}, 15_000);
});
