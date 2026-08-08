import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const FOLDER_PICKER_UNAVAILABLE_MESSAGE =
	"No system folder picker found (zenity or kdialog). Type or paste a folder path in the workspace selector instead.";

export type PickerExec = (
	file: string,
	args: string[],
) => Promise<{ stdout: string }>;

const defaultExec: PickerExec = (file, args) =>
	execFileAsync(file, args, { encoding: "utf8" });

// execFile reports two distinct failure shapes: a string errno `code`
// (ENOENT, EACCES, EMFILE, ENOMEM, ...) when the binary never ran, and the
// numeric exit code when the process ran and exited non-zero. zenity and
// kdialog both exit 1 when the user dismisses the dialog, so only that exact
// outcome counts as a cancellation — every other failure means the backend is
// unusable and the next candidate (or the manual path-entry error) should
// take over.
export function isPickerCancellation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === 1
	);
}

export function normalizePickedDirectory(stdout: string): string | null {
	const trimmed = stdout.trim();
	if (!trimmed) return null;
	// Dialogs occasionally return trailing separators (typed paths, GTK
	// location bar); strip them so downstream normalization matches catalog
	// entries.
	const withoutTrailing = trimmed.replace(/(?<=.)[\\/]+$/, "");
	return withoutTrailing || null;
}

// Async is load-bearing here: the native picker blocks until the user chooses
// a folder, and a synchronous exec would freeze every other sidecar command
// (chat streams, history, settings) for however long the dialog stays open.
//
// Contract: resolves to a path, resolves to null when the user cancels, and
// throws when no picker backend is usable so the UI can surface a manual
// path-entry fallback instead of a silent no-op.
export async function pickWorkspaceDirectory(
	exec: PickerExec = defaultExec,
	platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
	if (platform === "darwin") {
		try {
			const { stdout } = await exec("osascript", [
				"-e",
				'set theFolder to choose folder with prompt "Select workspace directory"',
				"-e",
				"return POSIX path of theFolder",
			]);
			return normalizePickedDirectory(stdout);
		} catch {
			// osascript ships with macOS; a failure here is a user cancel.
			return null;
		}
	}
	// Linux — try zenity, then kdialog. A backend that never ran (missing
	// binary, EACCES, EMFILE, ...) or died abnormally falls through to the
	// next candidate; only a clean cancel exit stops the search.
	const candidates: ReadonlyArray<readonly [string, string[]]> = [
		[
			"zenity",
			["--file-selection", "--directory", "--title=Select workspace directory"],
		],
		["kdialog", ["--getexistingdirectory", homedir()]],
	];
	for (const [file, args] of candidates) {
		try {
			const { stdout } = await exec(file, args);
			return normalizePickedDirectory(stdout);
		} catch (error) {
			if (isPickerCancellation(error)) return null;
		}
	}
	throw new Error(FOLDER_PICKER_UNAVAILABLE_MESSAGE);
}
