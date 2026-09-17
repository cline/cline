import { describe, expect, it } from "vitest";
import {
	getProcessStartToken,
	getProcessStartTokenAsync,
	parseLinuxProcessStartToken,
	probeProcessStartToken,
	probeProcessStartTokenAsync,
} from "./process-start-token";

describe("process start tokens", () => {
	it("rejects invalid process IDs without probing the operating system", async () => {
		expect(getProcessStartToken(0)).toBeUndefined();
		expect(getProcessStartToken(-1)).toBeUndefined();
		expect(getProcessStartToken(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
		await expect(getProcessStartTokenAsync(0)).resolves.toBeUndefined();
		expect(probeProcessStartToken(0)).toEqual({ status: "missing" });
		await expect(probeProcessStartTokenAsync(0)).resolves.toEqual({
			status: "missing",
		});
	});

	it("parses Linux start ticks when the command name contains a closing parenthesis", () => {
		const fields = [
			"S",
			...Array.from({ length: 18 }, (_, index) => String(index + 1)),
			"18446744073709551615",
		];
		expect(
			parseLinuxProcessStartToken(
				`42 (command ) name) ${fields.join(" ")}`,
				"boot-id\n",
			),
		).toBe("linux:boot-id:18446744073709551615");
	});

	it.each([
		"Z",
		"X",
		"x",
	])("does not identify a Linux process in the %s state as active", (state) => {
		const fields = [state, ...Array.from({ length: 19 }, () => "1")];
		expect(
			parseLinuxProcessStartToken(`42 (zombie) ${fields.join(" ")}`, "boot-id"),
		).toBeUndefined();
	});

	it.runIf(process.platform === "linux")(
		"captures the same live-process token synchronously and asynchronously on Linux",
		async () => {
			const synchronous = getProcessStartToken(process.pid);
			expect(synchronous).toMatch(/^linux:[^:]+:\d+$/);
			await expect(getProcessStartTokenAsync(process.pid)).resolves.toBe(
				synchronous,
			);
			expect(probeProcessStartToken(process.pid)).toEqual({
				status: "found",
				token: synchronous,
			});
			await expect(probeProcessStartTokenAsync(process.pid)).resolves.toEqual({
				status: "found",
				token: synchronous,
			});
		},
	);
});
