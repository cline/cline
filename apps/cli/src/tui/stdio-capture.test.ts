import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTuiStdioCapture } from "./stdio-capture";

describe("installTuiStdioCapture", () => {
	let restoreCapture: (() => void) | undefined;
	let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
	let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stdoutWriteSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		stderrWriteSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		restoreCapture?.();
		restoreCapture = undefined;
		stdoutWriteSpy.mockRestore();
		stderrWriteSpy.mockRestore();
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
	});

	it("suppresses stdout and stderr writes while capture is active", () => {
		restoreCapture = installTuiStdioCapture();

		process.stdout.write("\x1b[2m[hub] server restarted\x1b[0m\n");
		process.stderr.write("startup failed\n");

		expect(stdoutWriteSpy).not.toHaveBeenCalled();
		expect(stderrWriteSpy).not.toHaveBeenCalled();
		expect(consoleLogSpy).not.toHaveBeenCalled();
		expect(consoleErrorSpy).not.toHaveBeenCalled();
	});

	it("does not replay partial lines on restore", () => {
		restoreCapture = installTuiStdioCapture();

		process.stdout.write("hello ");
		expect(consoleLogSpy).not.toHaveBeenCalled();

		process.stdout.write("world\nnext");
		expect(consoleLogSpy).not.toHaveBeenCalledWith("hello world");
		expect(consoleLogSpy).not.toHaveBeenCalledWith("next");

		restoreCapture();
		restoreCapture = undefined;

		expect(consoleLogSpy).not.toHaveBeenCalledWith("next");
	});

	it("suppresses OSC sequences", () => {
		restoreCapture = installTuiStdioCapture();

		process.stdout.write("\x1b]52;c;SGVsbG8=\x1b\\visible text\n");
		process.stdout.write("\x1b]0;window title\x07only this\n");

		expect(consoleLogSpy).not.toHaveBeenCalled();
	});

	it("preserves write callbacks", async () => {
		restoreCapture = installTuiStdioCapture();

		await new Promise<void>((resolve) => {
			process.stdout.write("callback test\n", () => {
				resolve();
			});
		});

		expect(stdoutWriteSpy).not.toHaveBeenCalled();
		expect(consoleLogSpy).not.toHaveBeenCalled();
	});

	it("does not route captured writes through console methods", () => {
		restoreCapture = installTuiStdioCapture();

		consoleLogSpy.mockImplementation((text: string) => {
			process.stdout.write(`[re-entrant] ${text}\n`);
		});

		process.stdout.write("hello\n");

		expect(consoleLogSpy).not.toHaveBeenCalled();
	});

	it("restores the original stream writers", () => {
		restoreCapture = installTuiStdioCapture();

		restoreCapture();
		restoreCapture = undefined;
		process.stdout.write("visible");

		expect(stdoutWriteSpy).toHaveBeenCalledWith("visible");
	});
});
