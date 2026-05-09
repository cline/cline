import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatCreditBalance,
	installStreamErrorGuards,
	normalizeCreditBalance,
} from "./output";

describe("installStreamErrorGuards", () => {
	const originalExitCode = process.exitCode;
	const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
		code?: number,
	) => {
		throw new Error(`exit:${code ?? "undefined"}`);
	}) as typeof process.exit);

	beforeEach(() => {
		process.exitCode = undefined;
		exitSpy.mockClear();
	});

	afterEach(() => {
		process.exitCode = originalExitCode;
	});

	it("preserves a failing process exit code on stdout broken pipe", () => {
		installStreamErrorGuards();
		process.exitCode = 1;

		expect(() => {
			process.stdout.emit("error", { code: "EPIPE" });
		}).toThrow("exit:1");

		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("defaults to a successful exit code when none is set", () => {
		installStreamErrorGuards();

		expect(() => {
			process.stderr.emit("error", { code: "EPIPE" });
		}).toThrow("exit:0");

		expect(exitSpy).toHaveBeenCalledWith(0);
	});
});

describe("credit balance formatting", () => {
	it("normalizes Cline micro-credit balances before display", () => {
		expect(formatCreditBalance(normalizeCreditBalance(500_000))).toBe("$0.50");
		expect(formatCreditBalance(normalizeCreditBalance(5_000_000))).toBe(
			"$5.00",
		);
	});
});
