import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const FOLDER_PICKER_UNAVAILABLE_MESSAGE =
	"No system folder picker found (zenity or kdialog). Type or paste a folder path in the workspace selector instead.";

/** Minimal exec surface so tests can simulate picker backends failing. */
export type PickerExec = (
	command: string,
	args: string[],
) => Promise<{ stdout: string }>;

const defaultExec: PickerExec = (command, args) =>
	execFileAsync(command, args, { encoding: "utf8" });

interface ExecErrorShape {
	code?: unknown;
	signal?: unknown;
}

function execErrorShape(error: unknown): ExecErrorShape {
	return typeof error === "object" && error !== null
		? (error as ExecErrorShape)
		: {};
}

/** A binary that isn't installed rejects at spawn time with code "ENOENT". */
export function isPickerCommandMissing(error: unknown): boolean {
	return execErrorShape(error).code === "ENOENT";
}

// zenity, kdialog, and osascript all exit with status 1 when the user
// dismisses the dialog, which execFile reports as an error with a numeric
// `code` and no `signal`. Launch failures (EACCES, EMFILE, ENOMEM, ...)
// carry a string code instead, and crashes carry a `signal` — neither of
// those means the user cancelled, so they must not be swallowed.
export function isPickerCancellation(error: unknown): boolean {
	const { code, signal } = execErrorShape(error);
	return !signal && code === 1;
}

export function describePickerFailure(name: string, error: unknown): string {
	const { code, signal } = execErrorShape(error);
	if (signal) return `${name} was terminated by signal ${String(signal)}`;
	if (typeof code === "number") return `${name} exited with code ${code}`;
	if (typeof code === "string") return `${name} failed to launch (${code})`;
	return `${name} failed: ${error instanceof Error ? error.message : String(error)}`;
}

export function folderPickerFailedMessage(failures: string[]): string {
	return `The folder picker could not be opened (${failures.join("; ")}). Type or paste a folder path in the workspace selector instead.`;
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
// Contract: resolves to a path, resolves to null only when the user cancels,
// and throws when no picker backend could be opened — whether the binaries
// are missing or they failed to launch — so the UI can surface a manual
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
		} catch (error) {
			if (isPickerCancellation(error)) return null;
			// osascript ships with macOS, so anything else is a real failure.
			throw new Error(
				folderPickerFailedMessage([describePickerFailure("osascript", error)]),
			);
		}
	}
	// Linux — try zenity, then kdialog. A backend that is missing or fails to
	// launch falls through to the next candidate; only a clean cancel exit
	// from a dialog that actually opened is treated as user cancellation.
	const backends: { name: string; args: string[] }[] = [
		{
			name: "zenity",
			args: [
				"--file-selection",
				"--directory",
				"--title=Select workspace directory",
			],
		},
		{ name: "kdialog", args: ["--getexistingdirectory", homedir()] },
	];
	const failures: string[] = [];
	for (const backend of backends) {
		try {
			const { stdout } = await exec(backend.name, backend.args);
			return normalizePickedDirectory(stdout);
		} catch (error) {
			if (isPickerCancellation(error)) return null;
			if (!isPickerCommandMissing(error)) {
				failures.push(describePickerFailure(backend.name, error));
			}
		}
	}
	throw new Error(
		failures.length > 0
			? folderPickerFailedMessage(failures)
			: FOLDER_PICKER_UNAVAILABLE_MESSAGE,
	);
}

export const SAVE_DIALOG_UNAVAILABLE_MESSAGE =
	"No system save dialog found (zenity or kdialog).";

function saveDialogFailedMessage(failures: string[]): string {
	return `The save dialog could not be opened (${failures.join("; ")}).`;
}

// Only the line terminator the dialog prints: a file name may legitimately
// contain other leading or trailing whitespace.
function normalizePickedFilePath(stdout: string): string | null {
	const path = stdout.replace(/[\r\n]+$/, "");
	return path.trim() ? path : null;
}

/**
 * "Save as" dialog for sidecar/web mode (the Tauri shell uses its own native
 * command). Same contract as pickWorkspaceDirectory: resolves to the chosen
 * file path, resolves to null only when the user cancels, and throws when no
 * dialog could be opened. Each backend confirms replacing an existing file.
 */
export async function pickSaveFilePath(
	defaultFileName: string,
	exec: PickerExec = defaultExec,
	platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
	// A suggestion only ever names a file, never a location.
	const fileName = basename(defaultFileName.trim()) || "export.json";
	if (platform === "darwin") {
		try {
			// The name is passed as an argument, not spliced into the script, so
			// it cannot be interpreted as AppleScript.
			const { stdout } = await exec("osascript", [
				"-e",
				"on run argv",
				"-e",
				'set theFile to choose file name with prompt "Export session history" default name (item 1 of argv)',
				"-e",
				"return POSIX path of theFile",
				"-e",
				"end run",
				fileName,
			]);
			return normalizePickedFilePath(stdout);
		} catch (error) {
			if (isPickerCancellation(error)) return null;
			throw new Error(
				saveDialogFailedMessage([describePickerFailure("osascript", error)]),
			);
		}
	}
	const suggestedPath = join(homedir(), fileName);
	const backends: { name: string; args: string[] }[] = [
		{
			name: "zenity",
			args: [
				"--file-selection",
				"--save",
				"--confirm-overwrite",
				"--title=Export session history",
				`--filename=${suggestedPath}`,
			],
		},
		{ name: "kdialog", args: ["--getsavefilename", suggestedPath] },
	];
	const failures: string[] = [];
	for (const backend of backends) {
		try {
			const { stdout } = await exec(backend.name, backend.args);
			return normalizePickedFilePath(stdout);
		} catch (error) {
			if (isPickerCancellation(error)) return null;
			if (!isPickerCommandMissing(error)) {
				failures.push(describePickerFailure(backend.name, error));
			}
		}
	}
	throw new Error(
		failures.length > 0
			? saveDialogFailedMessage(failures)
			: SAVE_DIALOG_UNAVAILABLE_MESSAGE,
	);
}
