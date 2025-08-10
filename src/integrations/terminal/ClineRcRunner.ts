import * as vscode from "vscode"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { TerminalProcess } from "./TerminalProcess"

/**
 * Runs the user's ~/.clinerc (if present) in the given terminal and waits for completion,
 * with a hard 3s cap so we never get stuck.
 *
 * Behavior:
 * - Detects shell type (bash/zsh/sh, fish, PowerShell; skips cmd).
 * - Sources ~/.clinerc if it exists.
 * - Uses TerminalProcess to stream output and detect natural completion (via shell integration when available).
 * - If the rc doesn't finish quickly (e.g., it blocks), resolves after 3s to avoid hanging.
 */
export async function runClineRc(terminal: vscode.Terminal, shellPath?: string): Promise<void> {
	const clinercPath = path.join(os.homedir(), ".clinerc")

	if (!fs.existsSync(clinercPath)) {
		return
	}

	// Detect shell type from provided shellPath or environment
	const shellToCheck = shellPath || process.env.SHELL || process.env.COMSPEC || ""
	const shellName = path.basename(shellToCheck).toLowerCase()

	// Build shell-specific command to source rc
	let command: string | undefined
	if (shellName.includes("fish")) {
		// fish shell
		command = `test -f "${clinercPath}" ; and source "${clinercPath}"`
	} else if (shellName.includes("powershell") || shellName.includes("pwsh")) {
		// PowerShell
		const psPath = clinercPath.replace(/\\/g, "/")
		command = `$p="${psPath}"; if (Test-Path $p) { . $p }`
	} else if (shellName.includes("cmd")) {
		// cmd.exe not supported by .clinerc (POSIX/PowerShell), skip
		return
	} else {
		// Works for bash, zsh, sh
		command = `[ -f "${clinercPath}" ] && source "${clinercPath}"`
	}

	if (!command) {
		return
	}

	const rcProcess = new TerminalProcess()

	await new Promise<void>((resolve) => {
		let resolved = false

		const finish = () => {
			if (resolved) {
				return
			}
			resolved = true
			clearTimeout(timer)
			resolve()
		}

		// Prefer natural completion from TerminalProcess
		rcProcess.once("completed", finish)

		// Safety timeout to avoid hanging if rc blocks
		const timer = setTimeout(() => {
			try {
				// Stop listening and resolve early if the rc appears to block
				rcProcess.continue()
			} catch {}
			finish()
		}, 3000)

		// Start execution; TerminalProcess handles shell integration or fallback
		try {
			rcProcess.run(terminal, command!)
		} catch {
			// If starting fails, resolve via timeout
			finish()
		}
	})
}
