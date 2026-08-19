import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatCreditBalance,
	installStreamErrorGuards,
	normalizeCreditBalance,
	prepareTerminalForPostTuiOutput,
	setCurrentOutputMode,
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

describe("prepareTerminalForPostTuiOutput", () => {
	const originalStdoutIsTTY = process.stdout.isTTY;

	afterEach(() => {
		setCurrentOutputMode("text");
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: originalStdoutIsTTY,
		});
		vi.restoreAllMocks();
	});

	it("clears from the restored cursor before printing post-TUI text", () => {
		const writeSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});

		prepareTerminalForPostTuiOutput();

		expect(writeSpy).toHaveBeenCalledWith("\r\x1b[J");
	});

	it("does not write terminal control codes for non-TTY output", () => {
		const writeSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: false,
		});

		prepareTerminalForPostTuiOutput();

		expect(writeSpy).not.toHaveBeenCalled();
	});

	it("does not write terminal control codes in JSON output mode", () => {
		const writeSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
		setCurrentOutputMode("json");

		prepareTerminalForPostTuiOutput();

		expect(writeSpy).not.toHaveBeenCalled();
	});
});
