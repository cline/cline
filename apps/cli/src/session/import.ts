import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ImportAtifTrajectoryToBundleResult } from "@cline/session";
import { version as cliVersion } from "../../package.json";

/**
 * The file to import is missing, unreadable, not JSON or not a valid ATIF
 * trajectory. Commands exit 2 on it; `issues` lists the schema errors.
 */
export class SessionImportInputError extends Error {
	constructor(
		message: string,
		readonly issues: readonly string[] = [],
	) {
		super(message);
		this.name = "SessionImportInputError";
	}
}

export function isRegularFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/** `<dir>/<name>.bundle` next to `<dir>/<name>.json`. */
export function defaultImportOutDir(file: string): string {
	const path = resolve(file);
	return join(
		dirname(path),
		`${basename(path).replace(/\.json$/i, "")}.bundle`,
	);
}

/** Throws when `dir` exists and is not an empty directory. */
export async function assertImportTarget(
	dir: string,
	overwrite: boolean,
): Promise<void> {
	if (!existsSync(dir)) return;
	const entries = await readdir(dir).catch(() => null);
	if (entries === null) {
		throw new Error(`${dir} exists and is not a directory.`);
	}
	if (entries.length > 0 && !overwrite) {
		throw new Error(
			`${dir} is not empty; pass --force to replace an existing bundle there, or --out <dir> to write elsewhere.`,
		);
	}
}

async function readJsonFile(file: string): Promise<unknown> {
	if (!existsSync(file)) {
		throw new SessionImportInputError(`${file} does not exist.`);
	}
	if (!isRegularFile(file)) {
		throw new SessionImportInputError(`${file} is not a file.`);
	}
	const text = await readFile(file, "utf8");
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new SessionImportInputError(
			`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Imports the ATIF trajectory in `file` as a replay bundle in `outDir`, with
 * the import report in `import-report.json` next to the manifest.
 */
export async function importAtifFile(input: {
	file: string;
	outDir: string;
	overwrite?: boolean;
}): Promise<ImportAtifTrajectoryToBundleResult> {
	const file = resolve(input.file);
	const value = await readJsonFile(file);
	const { AtifImportError, importAtifTrajectoryToBundle } = await import(
		"@cline/session"
	);
	try {
		return await importAtifTrajectoryToBundle(value, resolve(input.outDir), {
			overwrite: input.overwrite === true,
			producer: { host: "cline-cli", hostVersion: cliVersion },
		});
	} catch (error) {
		if (error instanceof AtifImportError) {
			throw new SessionImportInputError(
				`${file} is not a valid ATIF trajectory:`,
				error.issues,
			);
		}
		throw error;
	}
}

/** Error message with its issues, one per line. */
export function formatSessionImportError(
	error: SessionImportInputError,
): string[] {
	return [error.message, ...error.issues.map((issue) => `  - ${issue}`)];
}
