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
});
