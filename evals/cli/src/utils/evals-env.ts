import * as fs from "fs"
import * as path from "path"
import chalk from "chalk"

/**
 * Creates an evals.env file in the specified directory
 * @param directory The directory where the evals.env file should be created
 * @returns True if the file was created, false if it already exists
 */
export function createEvalsEnvFile(directory: string): boolean {
	const evalsEnvPath = path.join(directory, "evals.env")

	// Check if the file already exists
	if (fs.existsSync(evalsEnvPath)) {
		console.log(chalk.yellow(`evals.env file already exists at ${evalsEnvPath}`))
		return false
	}

	// Create the file
	try {
		const content = `# This file activates Cline test mode
# Created at: ${new Date().toISOString()}
# 
# This file is automatically detected by the Cline extension
# and enables test mode for automated evaluations.
#
# Delete this file to deactivate test mode.
`
		fs.writeFileSync(evalsEnvPath, content)
		console.log(chalk.green(`Created evals.env file at ${evalsEnvPath}`))
		return true
	} catch (error) {
		console.error(chalk.red(`Error creating evals.env file: ${error}`))
		return false
	}
}

/**
 * Removes an evals.env file from the specified directory
 * @param directory The directory where the evals.env file should be removed
 * @returns True if the file was removed, false if it doesn't exist
 */
export function removeEvalsEnvFile(directory: string): boolean {
	const evalsEnvPath = path.join(directory, "evals.env")

	// Check if the file exists
	if (!fs.existsSync(evalsEnvPath)) {
		console.log(chalk.yellow(`No evals.env file found at ${evalsEnvPath}`))
		return false
	}

	// Remove the file
	try {
		fs.unlinkSync(evalsEnvPath)
		console.log(chalk.green(`Removed evals.env file from ${evalsEnvPath}`))
		return true
	} catch (error) {
		console.error(chalk.red(`Error removing evals.env file: ${error}`))
		return false
	}
}

/**
 * Checks if an evals.env file exists in the specified directory
 * @param directory The directory to check for an evals.env file
 * @returns True if the file exists, false otherwise
 */
export function checkEvalsEnvFile(directory: string): boolean {
	const evalsEnvPath = path.join(directory, "evals.env")
	const exists = fs.existsSync(evalsEnvPath)

	if (exists) {
		console.log(chalk.green(`evals.env file found at ${evalsEnvPath}`))
	} else {
		console.log(chalk.yellow(`No evals.env file found at ${evalsEnvPath}`))
	}

	return exists
}
