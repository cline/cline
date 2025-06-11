import execa from "execa"
import chalk from "chalk"
import path from "path"

interface RunDiffEvalOptions {
	modelId: string
	systemPromptName: string
	numberOfRuns: number
	parsingFunction: string
	diffEditFunction: string
	thinkingBudget: number
	parallel: boolean
	verbose: boolean
	testPath: string
	outputPath: string
	replay: boolean
}

export async function runDiffEvalHandler(options: RunDiffEvalOptions) {
	console.log(chalk.blue("Starting diff editing evaluation..."))

	// Resolve the path to the TestRunner.ts script relative to the current file
	const scriptPath = path.resolve(__dirname, "../../../diff_editing/TestRunner.ts")

	// Construct the arguments array for the execa call
	const args = [
		"--model-id",
		options.modelId,
		"--system-prompt-name",
		options.systemPromptName,
		"--number-of-runs",
		String(options.numberOfRuns),
		"--parsing-function",
		options.parsingFunction,
		"--diff-edit-function",
		options.diffEditFunction,
	]

	// Conditionally add the optional arguments
	if (options.testPath) {
		args.push("--test-path", options.testPath)
	}
	if (options.outputPath) {
		args.push("--output-path", options.outputPath)
	}
	if (options.thinkingBudget > 0) {
		args.push("--thinking-budget", String(options.thinkingBudget))
	}

	if (options.parallel) {
		args.push("--parallel")
	}

	if (options.replay) {
		args.push("--replay")
	}

	if (options.verbose) {
		args.push("--verbose")
	}

	try {
		console.log(chalk.gray(`Executing: npx tsx ${scriptPath} ${args.join(" ")}`))

		// Execute the script as a child process
		// We use 'inherit' to stream the stdout/stderr directly to the user's terminal
		const subprocess = execa("npx", ["tsx", scriptPath, ...args], {
			stdio: "inherit",
		})

		await subprocess

		console.log(chalk.green("Diff editing evaluation completed successfully."))
	} catch (error) {
		console.error(chalk.red("An error occurred during the diff editing evaluation."))
		// The 'inherit' stdio will have already printed the error details from the script
		process.exit(1)
	}
}
