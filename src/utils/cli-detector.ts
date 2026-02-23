import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

/**
 * Check if the Cline CLI tool is installed on the system
 * @returns true if CLI is installed, false otherwise
 */
export async function isClineCliInstalled(): Promise<boolean> {
	try {
		// Try to get the version of the cline CLI tool
		// This will fail if the tool is not installed
		const { stdout } = await execAsync("cline version", {
			timeout: 5000, // 5 second timeout
		})

		// If we get here, the CLI is installed
		// We could also validate the version if needed
		return stdout.includes("Cline CLI Version") || stdout.includes("Cline Core Version")
	} catch (error) {
		// Command failed, which likely means CLI is not installed
		// or not in PATH
		return false
	}
}
