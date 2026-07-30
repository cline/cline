import { describe, expect, it } from "vitest";
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
});
