import execa from "execa"
import chalk from "chalk"
import path from "path"

interface RunDiffEvalOptions {
	modelIds: string
	systemPromptName: string
	validAttemptsPerCase: number
	maxAttemptsPerCase?: number
	parsingFunction: string
	diffEditFunction: string
	thinkingBudget: number
	provider: string
	parallel: boolean
	verbose: boolean
	testPath: string
	outputPath: string
	replay: boolean
	replayRunId?: string
	diffApplyFile?: string
	saveLocally: boolean
	maxCases?: number
}

export async function runDiffEvalHandler(options: RunDiffEvalOptions) {
	console.log(chalk.blue("Starting diff editing evaluation..."))

	// Resolve the path to the TestRunner.ts script relative to the current file
	const scriptPath = path.resolve(__dirname, "../../../diff-edits/TestRunner.ts")

	// Construct the arguments array for the execa call
	const args = [
		"--model-ids",
		options.modelIds,
		"--system-prompt-name",
		options.systemPromptName,
		"--valid-attempts-per-case",
		String(options.validAttemptsPerCase),
		"--parsing-function",
		options.parsingFunction,
		"--diff-edit-function",
		options.diffEditFunction,
		"--provider",
		options.provider,
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

	if (options.replayRunId) {
		args.push("--replay-run-id", options.replayRunId)
	}

	if (options.diffApplyFile) {
		args.push("--diff-apply-file", options.diffApplyFile)
	}

	if (options.verbose) {
		args.push("--verbose")
	}

	if (options.maxAttemptsPerCase) {
		args.push("--max-attempts-per-case", String(options.maxAttemptsPerCase))
	}

	if (options.maxCases) {
		args.push("--max-cases", String(options.maxCases))
	}

	if (options.saveLocally) {
		args.push("--save-locally")
	}

	try {
		console.log(chalk.gray(`Executing: npx tsx ${scriptPath} ${args.join(" ")}`))

		// Execute the script as a child process
		// We use 'inherit' to stream the stdout/stderr directly to the user's terminal
		const subprocess = execa("npx", ["tsx", "--tsconfig", path.resolve(__dirname, "../../../tsconfig.json"), scriptPath, ...args], {
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
