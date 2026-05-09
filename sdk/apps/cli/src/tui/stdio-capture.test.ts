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

	it("routes stdout and stderr writes into console capture", () => {
		restoreCapture = installTuiStdioCapture();

		process.stdout.write("\x1b[2m[hub] server restarted\x1b[0m\n");
		process.stderr.write("startup failed\n");

		expect(stdoutWriteSpy).not.toHaveBeenCalled();
		expect(stderrWriteSpy).not.toHaveBeenCalled();
		expect(consoleLogSpy).toHaveBeenCalledWith("[hub] server restarted");
		expect(consoleErrorSpy).toHaveBeenCalledWith("startup failed");
	});

	it("buffers partial lines until newline or restore", () => {
		restoreCapture = installTuiStdioCapture();

		process.stdout.write("hello ");
		expect(consoleLogSpy).not.toHaveBeenCalled();

		process.stdout.write("world\nnext");
		expect(consoleLogSpy).toHaveBeenCalledWith("hello world");
		expect(consoleLogSpy).not.toHaveBeenCalledWith("next");

		restoreCapture();
		restoreCapture = undefined;

		expect(consoleLogSpy).toHaveBeenCalledWith("next");
	});

	it("strips OSC sequences from captured output", () => {
		restoreCapture = installTuiStdioCapture();

		process.stdout.write("\x1b]52;c;SGVsbG8=\x1b\\visible text\n");
		process.stdout.write("\x1b]0;window title\x07only this\n");

		expect(consoleLogSpy).toHaveBeenCalledWith("visible text");
		expect(consoleLogSpy).toHaveBeenCalledWith("only this");
	});

	it("does not recurse when console methods trigger stdout writes", () => {
		restoreCapture = installTuiStdioCapture();

		consoleLogSpy.mockImplementation((text: string) => {
			process.stdout.write(`[re-entrant] ${text}\n`);
		});

		process.stdout.write("hello\n");

		expect(consoleLogSpy).toHaveBeenCalledTimes(1);
		expect(consoleLogSpy).toHaveBeenCalledWith("hello");
	});

	it("restores the original stream writers", () => {
		restoreCapture = installTuiStdioCapture();

		restoreCapture();
		restoreCapture = undefined;
		process.stdout.write("visible");

		expect(stdoutWriteSpy).toHaveBeenCalledWith("visible");
	});
});
