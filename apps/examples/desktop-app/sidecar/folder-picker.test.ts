import { describe, expect, it, vi } from "vitest";
import {
	FOLDER_PICKER_UNAVAILABLE_MESSAGE,
	isPickerCancellation,
	normalizePickedDirectory,
	type PickerExec,
	pickWorkspaceDirectory,
} from "./folder-picker";

function execError(code: unknown): Error & { code?: unknown } {
	const error = new Error(`exec failed (${String(code)})`) as Error & {
		code?: unknown;
	};
	error.code = code;
	return error;
}

function scriptedExec(results: Record<string, { stdout: string } | Error>): {
	exec: PickerExec;
	calls: string[];
} {
	const calls: string[] = [];
	const exec: PickerExec = async (file) => {
		calls.push(file);
		const result = results[file];
		if (!result) throw execError("ENOENT");
		if (result instanceof Error) throw result;
		return result;
	};
	return { exec, calls };
}

describe("isPickerCancellation", () => {
	it("treats a clean exit code 1 as the user cancelling", () => {
		expect(isPickerCancellation(execError(1))).toBe(true);
	});

	it.each([
		"ENOENT",
		"EACCES",
		"EMFILE",
		"ENOMEM",
	])("treats the %s launch failure as a backend failure", (errno) => {
		expect(isPickerCancellation(execError(errno))).toBe(false);
	});

	it("treats other exit codes and non-errors as backend failures", () => {
		expect(isPickerCancellation(execError(255))).toBe(false);
		expect(isPickerCancellation(execError(null))).toBe(false);
		expect(isPickerCancellation(undefined)).toBe(false);
	});
});

describe("normalizePickedDirectory", () => {
	it("trims whitespace and trailing separators", () => {
		expect(normalizePickedDirectory(" /home/user/project/\n")).toBe(
			"/home/user/project",
		);
		expect(normalizePickedDirectory("/\n")).toBe("/");
	});

	it("returns null for empty output", () => {
		expect(normalizePickedDirectory("\n")).toBeNull();
	});
});

describe("pickWorkspaceDirectory (linux)", () => {
	it("returns the zenity selection when zenity succeeds", async () => {
		const { exec, calls } = scriptedExec({
			zenity: { stdout: "/home/user/project\n" },
		});
		await expect(pickWorkspaceDirectory(exec, "linux")).resolves.toBe(
			"/home/user/project",
		);
		expect(calls).toEqual(["zenity"]);
	});

	it("returns null on zenity cancel without trying kdialog", async () => {
		const { exec, calls } = scriptedExec({ zenity: execError(1) });
		await expect(pickWorkspaceDirectory(exec, "linux")).resolves.toBeNull();
		expect(calls).toEqual(["zenity"]);
	});

	it("falls back to kdialog when zenity fails to launch", async () => {
		const { exec, calls } = scriptedExec({
			zenity: execError("EACCES"),
			kdialog: { stdout: "/home/user/other\n" },
		});
		await expect(pickWorkspaceDirectory(exec, "linux")).resolves.toBe(
			"/home/user/other",
		);
		expect(calls).toEqual(["zenity", "kdialog"]);
	});

	it("returns null on kdialog cancel after zenity is missing", async () => {
		const { exec } = scriptedExec({
			zenity: execError("ENOENT"),
			kdialog: execError(1),
		});
		await expect(pickWorkspaceDirectory(exec, "linux")).resolves.toBeNull();
	});

	it.each([
		["ENOENT", "ENOENT"],
		["EACCES", "EMFILE"],
		["ENOMEM", "EACCES"],
	])("throws the unavailable error when zenity fails with %s and kdialog with %s", async (zenityCode, kdialogCode) => {
		const { exec } = scriptedExec({
			zenity: execError(zenityCode),
			kdialog: execError(kdialogCode),
		});
		await expect(pickWorkspaceDirectory(exec, "linux")).rejects.toThrow(
			FOLDER_PICKER_UNAVAILABLE_MESSAGE,
		);
	});
});

describe("pickWorkspaceDirectory (darwin)", () => {
	it("returns the osascript selection", async () => {
		const exec = vi
			.fn<PickerExec>()
			.mockResolvedValue({ stdout: "/Users/user/project/\n" });
		await expect(pickWorkspaceDirectory(exec, "darwin")).resolves.toBe(
			"/Users/user/project",
		);
		expect(exec).toHaveBeenCalledTimes(1);
		expect(exec.mock.calls[0]?.[0]).toBe("osascript");
	});

	it("returns null when the user cancels", async () => {
		const exec = vi.fn<PickerExec>().mockRejectedValue(execError(1));
		await expect(pickWorkspaceDirectory(exec, "darwin")).resolves.toBeNull();
	});
});
