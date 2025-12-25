/**
 * Utility for graceful process termination with SIGKILL fallback.
 *
 * Handles cross-platform process tree termination:
 * - Sends SIGTERM first for graceful shutdown
 * - Waits for configurable timeout
 * - Falls back to SIGKILL if process doesn't exit
 */

import { ChildProcess } from "child_process"
import treeKill from "tree-kill"

export interface TerminateProcessTreeOptions {
	/** Process ID to terminate */
	pid: number
	/** Child process reference (for exit event listening) */
	childProcess?: ChildProcess | null
	/** Function to check if process has already completed */
	isCompleted: () => boolean
	/** Timeout in ms before escalating to SIGKILL (default: 2000) */
	gracefulTimeoutMs?: number
}

/**
 * Terminates a process tree with graceful shutdown and SIGKILL fallback.
 *
 * Uses tree-kill to handle cross-platform process tree termination:
 * - On Windows: Uses taskkill /T /F (always force kills)
 * - On Unix: Sends signal to entire process tree
 *
 * @param options Termination options
 */
export async function terminateProcessTree(options: TerminateProcessTreeOptions): Promise<void> {
	const { pid, childProcess, isCompleted, gracefulTimeoutMs = 2000 } = options

	// Send SIGTERM for graceful shutdown
	treeKill(pid, "SIGTERM")

	// Wait for graceful shutdown or timeout
	const gracefulTimeout = new Promise<void>((resolve) => setTimeout(resolve, gracefulTimeoutMs))
	const processExit = new Promise<void>((resolve) => {
		if (childProcess) {
			childProcess.once("exit", () => resolve())
		} else {
			// No child process reference, just wait for timeout
			resolve()
		}
	})

	await Promise.race([processExit, gracefulTimeout])

	// Force kill if still running
	if (!isCompleted()) {
		treeKill(pid, "SIGKILL")
	}
}
