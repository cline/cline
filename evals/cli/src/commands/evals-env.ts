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

	console.log(chalk.blue(`Working with directory: ${directory}`))

	// Perform the requested action
	switch (options.action) {
		case "create":
			console.log(chalk.blue("Creating evals.env file..."))
			createEvalsEnvFile(directory)
			console.log(chalk.green("The Cline extension should now detect this file and enter test mode."))
			console.log(chalk.yellow("Note: You may need to reload VSCode for the changes to take effect."))
			break

		case "remove":
			console.log(chalk.blue("Removing evals.env file..."))
			removeEvalsEnvFile(directory)
			console.log(chalk.green("The Cline extension should now exit test mode."))
			console.log(chalk.yellow("Note: You may need to reload VSCode for the changes to take effect."))
			break

		case "check":
			console.log(chalk.blue("Checking for evals.env file..."))
			const exists = checkEvalsEnvFile(directory)
			if (exists) {
				console.log(chalk.green("The Cline extension should be in test mode."))
			} else {
				console.log(chalk.yellow("The Cline extension should not be in test mode."))
			}
			break

		default:
			console.error(chalk.red(`Unknown action: ${options.action}`))
			console.log(chalk.yellow("Valid actions are: create, remove, check"))
			break
	}
}
