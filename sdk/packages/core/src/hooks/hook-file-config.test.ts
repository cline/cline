import { afterEach, describe, expect, it } from "vitest";
import { HookConfigFileName, toHookConfigFileName } from "./hook-file-config";

describe("hook file config", () => {
	afterEach(() => {
		delete process.env.CLINE_DATA_DIR;
	});

	it("recognizes PowerShell hook files", () => {
		expect(toHookConfigFileName("PreToolUse.ps1")).toBe(
			HookConfigFileName.PreToolUse,
		);
		expect(toHookConfigFileName("TaskError.ps1")).toBe(
			HookConfigFileName.TaskError,
		);
	});

	it("recognizes hook files with uppercase and mixed-case extensions", () => {
		expect(toHookConfigFileName("PreToolUse.SH")).toBe(
			HookConfigFileName.PreToolUse,
		);
		expect(toHookConfigFileName("PostToolUse.Ts")).toBe(
			HookConfigFileName.PostToolUse,
		);
		expect(toHookConfigFileName("TaskStart.PY")).toBe(
			HookConfigFileName.TaskStart,
		);
		expect(toHookConfigFileName("TaskError.PS1")).toBe(
			HookConfigFileName.TaskError,
		);
	});
});
