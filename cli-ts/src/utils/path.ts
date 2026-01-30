import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const data = process.env.CLINE_DATA_DIR ?? path.join(os.homedir(), ".cline", "data")

const log = process.env.CLINE_LOG_DIR ?? path.join(data, "logs")

export const CLINE_CLI_DIR = {
	data,
	log,
}

/**
 * Find binary location for CLI.
 * Uses 'which' (Unix) or 'where' (Windows) to locate binaries in the system PATH.
 * This is needed for tools like ripgrep that the search_files tool uses.
 */
export async function getCliBinaryPath(name: string): Promise<string> {
	// The only binary currently supported is ripgrep (rg)
	if (!name.startsWith("rg")) {
		throw new Error(`Binary '${name}' is not supported`)
	}

	const isWindows = process.platform === "win32"
	const whichCommand = isWindows ? "where" : "which"

	try {
		const result = execFileSync(whichCommand, [name], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		})
		// 'which' returns the path, 'where' on Windows may return multiple lines
		const binPath = result.trim().split("\n")[0].trim()
		if (binPath) {
			return binPath
		}
	} catch {
		// Binary not found in PATH
	}

	throw new Error(
		`Could not find '${name}' in system PATH. ` +
			`Please install ripgrep: https://github.com/BurntSushi/ripgrep#installation`,
	)
}
