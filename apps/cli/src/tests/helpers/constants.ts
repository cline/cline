// ---------------------------------------------------------------------------
// Shared constants for all test files.
//
// tui-test workers run with a minimal PATH, so we resolve the binary
// explicitly rather than relying on PATH lookup at test runtime.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveBunBin(): string {
	const bunBin = [process.env.npm_execpath, process.execPath].find(
		(candidate) =>
			candidate && /^bun(?:\.exe)?$/i.test(path.basename(candidate)),
	);
	if (bunBin) {
		return bunBin;
	}

	throw new Error("Unable to resolve Bun executable. Run tests with bun");
}

function resolveClineBin(): string {
	const localBin = fileURLToPath(
		new URL("../../../dist/index.js", import.meta.url),
	);
	if (fs.existsSync(localBin)) {
		return localBin;
	}

	throw new Error(
		"Unable to resolve cline binary. Run bun -F @cline/cli build",
	);
}

function quoteShellArg(value: string): string {
	const shellValue =
		process.platform === "win32" ? value.replaceAll("\\", "/") : value;
	return `'${shellValue.replaceAll("'", "'\"'\"'")}'`;
}

export const BUN_BIN = resolveBunBin();
export const CLINE_BIN = resolveClineBin();
export const CLINE_SHELL_COMMAND = `${quoteShellArg(BUN_BIN)} ${quoteShellArg(CLINE_BIN)}`;

// Standard terminal dimensions used across test suites
export const TERMINAL_WIDE = { columns: 120, rows: 50 } as const;
export const TERMINAL_NARROW = { columns: 80, rows: 30 } as const;

export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_FAIL = 1;
export const EXIT_CODE_TIMEOUT = 124;
