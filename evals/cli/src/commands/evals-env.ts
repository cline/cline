import * as path from "path"
import chalk from "chalk"
import { createEvalsEnvFile, removeEvalsEnvFile, checkEvalsEnvFile } from "../utils/evals-env"

interface EvalsEnvOptions {
	action: "create" | "remove" | "check"
	directory?: string
}

/**
 * Handler for the evals-env command
 * @param options Command options
 */
export async function evalsEnvHandler(options: EvalsEnvOptions): Promise<void> {
	// Determine the directory to use - default to repository root instead of current directory
	const currentDir = process.cwd()
	const repoRoot = path.resolve(currentDir, "..", "..") // Navigate up from evals/cli to root
	const directory = options.directory || repoRoot

	// Perform the requested action
	switch (options.action) {
		case "create":
			createEvalsEnvFile(directory)

			break

		case "remove":
			removeEvalsEnvFile(directory)

			break

		case "check":
			const exists = checkEvalsEnvFile(directory)
			if (exists) {
			} else {
			}
			break

		default:
			console.error(chalk.red(`Unknown action: ${options.action}`))

			break
	}
}
