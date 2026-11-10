import { describe, expect, it } from "vitest";
import {
	FOLDER_PICKER_UNAVAILABLE_MESSAGE,
	normalizePickedDirectory,
	type PickerExec,
	pickSaveFilePath,
	pickWorkspaceDirectory,
	SAVE_DIALOG_UNAVAILABLE_MESSAGE,
} from "./workspace-picker";

/** Builds an error shaped like execFile's rejection values. */
function execError(props: { code?: unknown; signal?: unknown }): Error {
	return Object.assign(new Error("Command failed"), props);
}

const CANCEL = execError({ code: 1 });
const MISSING = execError({ code: "ENOENT" });
const LAUNCH_FAILURE = execError({ code: "EACCES" });
const CRASH = execError({ code: null, signal: "SIGSEGV" });

/**
 * Fake exec that responds per backend name and records the invocation order.
 * A function outcome resolves with its return value as stdout; an Error
 * outcome rejects.
 */
function fakeExec(outcomes: Record<string, string | Error>): {
	exec: PickerExec;
	calls: string[];
} {
	const calls: string[] = [];
	const exec: PickerExec = (command) => {
		calls.push(command);
		const outcome = outcomes[command];
		if (outcome === undefined)
			return Promise.reject(execError({ code: "ENOENT" }));
		if (outcome instanceof Error) return Promise.reject(outcome);
		return Promise.resolve({ stdout: outcome });
	};
	return { exec, calls };
}

describe("pickWorkspaceDirectory (linux)", () => {
	it("returns the zenity selection", async () => {
		const { exec } = fakeExec({ zenity: "/home/user/projects/app\n" });
		await expect(pickWorkspaceDirectory(exec, "linux")).resolves.toBe(
			"/home/user/projects/app",
		);
	});

	it("returns null when the user cancels the zenity dialog", async () => {
		const { exec, calls } = fakeExec({ zenity: CANCEL });
		await expect(pickWorkspaceDirectory(exec, "linux")).resolves.toBeNull();
		expect(calls).toEqual(["zenity"]);
	});

	it("falls back to kdialog when zenity is missing", async () => {
		const { exec, calls } = fakeExec({
			zenity: MISSING,
			kdialog: "/home/user/projects/app\n",
		});
		await expect(pickWorkspaceDirectory(exec, "linux")).resolves.toBe(
			"/home/user/projects/app",
		);
		expect(calls).toEqual(["zenity", "kdialog"]);
	});

	// Regression: launch failures (EACCES, EMFILE, ENOMEM, ...) used to be
	// classified as user cancellation, which skipped the kdialog fallback and
	// silently swallowed the error.
	it("falls back to kdialog when zenity fails to launch", async () => {
		const { exec, calls } = fakeExec({
			zenity: LAUNCH_FAILURE,
			kdialog: "/home/user/projects/app\n",
		});
		await expect(pickWorkspaceDirectory(exec, "linux")).resolves.toBe(
			"/home/user/projects/app",
		);
		expect(calls).toEqual(["zenity", "kdialog"]);
	});

	it("throws a descriptive error when every backend fails to launch", async () => {
		const { exec } = fakeExec({ zenity: LAUNCH_FAILURE, kdialog: CRASH });
		await expect(pickWorkspaceDirectory(exec, "linux")).rejects.toThrow(
			"zenity failed to launch (EACCES); kdialog was terminated by signal SIGSEGV",
		);
	});

	it("throws the unavailable message when no backend is installed", async () => {
		const { exec } = fakeExec({});
		await expect(pickWorkspaceDirectory(exec, "linux")).rejects.toThrow(
			FOLDER_PICKER_UNAVAILABLE_MESSAGE,
		);
	});
});

describe("pickWorkspaceDirectory (darwin)", () => {
	it("returns the chosen folder", async () => {
		const { exec } = fakeExec({ osascript: "/Users/user/projects/app/\n" });
		await expect(pickWorkspaceDirectory(exec, "darwin")).resolves.toBe(
			"/Users/user/projects/app",
		);
	});

	it("returns null when the user cancels", async () => {
		const { exec } = fakeExec({ osascript: CANCEL });
		await expect(pickWorkspaceDirectory(exec, "darwin")).resolves.toBeNull();
	});

	it("throws when osascript fails for a reason other than cancel", async () => {
		const { exec } = fakeExec({ osascript: execError({ code: "EMFILE" }) });
		await expect(pickWorkspaceDirectory(exec, "darwin")).rejects.toThrow(
			"osascript failed to launch (EMFILE)",
		);
	});
});

describe("pickSaveFilePath", () => {
	/** Like fakeExec, but also records the arguments each backend received. */
	function recordingExec(outcomes: Record<string, string | Error>) {
		const calls: Array<{ command: string; args: string[] }> = [];
		const exec: PickerExec = (command, args) => {
			calls.push({ command, args });
			const outcome = outcomes[command];
			if (outcome === undefined) return Promise.reject(MISSING);
			if (outcome instanceof Error) return Promise.reject(outcome);
			return Promise.resolve({ stdout: outcome });
		};
		return { exec, calls };
	}

	it("returns the path the user saved to, with the name they typed", async () => {
		const { exec, calls } = recordingExec({
			osascript: "/Users/user/Desktop/my export.json\n",
		});
		await expect(
			pickSaveFilePath("ses-1.messages.json", exec, "darwin"),
		).resolves.toBe("/Users/user/Desktop/my export.json");
		// Passed as an argument rather than spliced into the script.
		expect(calls[0].args.at(-1)).toBe("ses-1.messages.json");
		expect(calls[0].args.join(" ")).toContain("choose file name");
	});

	it("suggests only a file name, never a location", async () => {
		const { exec, calls } = recordingExec({ osascript: "/tmp/out.json\n" });
		await pickSaveFilePath("../../etc/ses-1.messages.json", exec, "darwin");
		expect(calls[0].args.at(-1)).toBe("ses-1.messages.json");
	});

	it("returns null when the user cancels", async () => {
		const { exec } = recordingExec({ osascript: CANCEL });
		await expect(
			pickSaveFilePath("ses-1.messages.json", exec, "darwin"),
		).resolves.toBeNull();
	});

	it("throws when osascript fails for a reason other than cancel", async () => {
		const { exec } = recordingExec({ osascript: LAUNCH_FAILURE });
		await expect(
			pickSaveFilePath("ses-1.messages.json", exec, "darwin"),
		).rejects.toThrow("osascript failed to launch (EACCES)");
	});

	it("asks zenity for a save dialog that confirms overwriting", async () => {
		const { exec, calls } = recordingExec({
			zenity: "/home/user/out.json\n",
		});
		await expect(
			pickSaveFilePath("ses-1.messages.json", exec, "linux"),
		).resolves.toBe("/home/user/out.json");
		expect(calls[0].args).toContain("--save");
		expect(calls[0].args).toContain("--confirm-overwrite");
		expect(calls[0].args.at(-1)).toMatch(/ses-1\.messages\.json$/);
	});

	it("falls back to kdialog when zenity is missing", async () => {
		const { exec, calls } = recordingExec({
			zenity: MISSING,
			kdialog: "/home/user/out.json\n",
		});
		await expect(
			pickSaveFilePath("ses-1.messages.json", exec, "linux"),
		).resolves.toBe("/home/user/out.json");
		expect(calls.map((call) => call.command)).toEqual(["zenity", "kdialog"]);
		expect(calls[1].args[0]).toBe("--getsavefilename");
	});

	it("throws the unavailable message when no backend is installed", async () => {
		const { exec } = recordingExec({});
		await expect(
			pickSaveFilePath("ses-1.messages.json", exec, "linux"),
		).rejects.toThrow(SAVE_DIALOG_UNAVAILABLE_MESSAGE);
	});
});

describe("normalizePickedDirectory", () => {
	it("strips trailing whitespace and separators", () => {
		expect(normalizePickedDirectory("/home/user/app/\n")).toBe(
			"/home/user/app",
		);
		expect(normalizePickedDirectory("C:\\Users\\me\\app\\\\")).toBe(
			"C:\\Users\\me\\app",
		);
	});

	it("keeps the filesystem root intact", () => {
		expect(normalizePickedDirectory("/\n")).toBe("/");
	});

	it("returns null for empty output", () => {
		expect(normalizePickedDirectory("   \n")).toBeNull();
	});
});
