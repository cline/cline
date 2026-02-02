import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
// @ts-expect-error - @vscode/ripgrep has no type declarations
import { rgPath } from "@vscode/ripgrep"

const data = process.env.CLINE_DATA_DIR ?? path.join(os.homedir(), ".cline", "data")

const log = process.env.CLINE_LOG_DIR ?? path.join(data, "logs")

export const CLINE_CLI_DIR = {
	data,
	log,
}

/**
 * Find binary location for CLI.
 * First checks system PATH (for brew users), then falls back to bundled @vscode/ripgrep.
 */
export async function getCliBinaryPath(name: string): Promise<string> {
	// The only binary currently supported is ripgrep (rg)
	if (!name.startsWith("rg")) {
		throw new Error(`Binary '${name}' is not supported`)
	}

	const isWindows = process.platform === "win32"
	const whichCommand = isWindows ? "where" : "which"

	// First try system PATH (for brew users who have ripgrep installed)
	try {
		const result = execFileSync(whichCommand, [name], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		})
		const binPath = result.trim().split("\n")[0].trim()
		if (binPath) {
			return binPath
		}
	} catch {
		// Binary not found in PATH, fall back to bundled version
	}

	// Fall back to bundled @vscode/ripgrep (for npm users)
	return rgPath
}
