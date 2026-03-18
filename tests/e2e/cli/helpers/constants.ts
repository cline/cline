// ---------------------------------------------------------------------------
// Shared constants for all test files.
//
// tui-test workers run with a minimal PATH, so we resolve the binary
// explicitly rather than relying on PATH lookup at test runtime.
// ---------------------------------------------------------------------------

import fs from "fs"
import path from "path"

function resolveClineBin(): string {
	const localBin = path.resolve(process.cwd(), "..", "..", "..", "cli", "dist", "cli.mjs")
	if (fs.existsSync(localBin)) {
		return localBin
	}

	throw new Error("Unable to resolve cline binary. build cli/dist/cli.mjs.")
}

export const CLINE_BIN = resolveClineBin()

// Standard terminal dimensions used across test suites
export const TERMINAL_WIDE = { columns: 120, rows: 50 } as const
export const TERMINAL_NARROW = { columns: 80, rows: 30 } as const
