import { getCwd } from "@/utils/path"
import type Anthropic from "@anthropic-ai/sdk"
import { execa } from "execa"
import readline from "readline"
import { ClaudeCodeMessage } from "./types"

type ClaudeCodeOptions = {
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	path?: string
	modelId?: string
	thinkingBudgetTokens?: number
}

type ProcessState = {
	partialData: string | null
	error: Error | null
	stderrLogs: string
	exitCode: number | null
}

export async function* runClaudeCode(options: ClaudeCodeOptions): AsyncGenerator<ClaudeCodeMessage | string> {
	const process = runProcess(options, await getCwd())

	const rl = readline.createInterface({
		input: process.stdout,
	})

	try {
		const processState: ProcessState = {
			error: null,
			stderrLogs: "",
			exitCode: null,
			partialData: null,
		}

		process.stderr.on("data", (data) => {
			processState.stderrLogs += data.toString()
		})

		process.on("close", (code) => {
			processState.exitCode = code
		})

		process.on("error", (err) => {
			processState.error = err
		})

		for await (const line of rl) {
			if (processState.error) {
				throw processState.error
			}

			if (line.trim()) {
				const chunk = parseChunk(line, processState)

				if (!chunk) {
					continue
				}

				yield chunk
			}
		}

		// We rely on the assistant message. If the output was truncated, it's better having a poorly formatted message
		// from which to extract something, than throwing an error/showing the model didn't return any messages.
		if (processState.partialData && processState.partialData.startsWith(`{"type":"assistant"`)) {
			yield processState.partialData
		}

		const { exitCode } = await process
		if (exitCode !== null && exitCode !== 0) {
			const errorOutput = processState.error?.message || processState.stderrLogs?.trim()
			throw new Error(
				`Claude Code process exited with code ${exitCode}.${errorOutput ? ` Error output: ${errorOutput}` : ""}`,
			)
		}
	} catch (err) {
		// When the command fails, execa throws an error with the arguments, which include the whole system prompt.
		// We want to log that, but not show it to the user.
		console.error(`Error during Claude Code execution:`, err)
		if (err instanceof Error) {
			const startOfCommand = err.message.indexOf(": ")
			if (startOfCommand !== -1) {
				const messageWithoutCommand = err.message.slice(0, startOfCommand).trim()

				throw new Error(messageWithoutCommand, { cause: err })
			}
		}

		throw err
	} finally {
		rl.close()
		if (!process.killed) {
			process.kill()
		}
	}
}

// We want the model to use our custom tool format instead of built-in tools.
// Disabling built-in tools prevents tool-only responses and ensures text output.
const claudeCodeTools = [
	"Task",
	"Bash",
	"Glob",
	"Grep",
	"LS",
	"exit_plan_mode",
	"Read",
	"Edit",
	"MultiEdit",
	"Write",
	"NotebookRead",
	"NotebookEdit",
	"WebFetch",
	"TodoRead",
	"TodoWrite",
	"WebSearch",
].join(",")

const CLAUDE_CODE_TIMEOUT = 600000 // 10 minutes
// https://github.com/sindresorhus/execa/blob/main/docs/api.md#optionsmaxbuffer
const BUFFER_SIZE = 20_000_000 // 20 MB

function runProcess({ systemPrompt, messages, path, modelId, thinkingBudgetTokens }: ClaudeCodeOptions, cwd: string) {
	const claudePath = path?.trim() || "claude"

	const args = [
		"-p",
		"--system-prompt",
		systemPrompt,
		"--verbose",
		"--output-format",
		"stream-json",
		"--disallowedTools",
		claudeCodeTools,
		// Cline will handle recursive calls
		"--max-turns",
		"1",
	]

	if (modelId) {
		args.push("--model", modelId)
	}

	/**
	 * @see {@link https://docs.anthropic.com/en/docs/claude-code/settings#environment-variables}
	 */
	const env: NodeJS.ProcessEnv = {
		...process.env,
		// Respect the user's environment variables but set defaults.
		// The default is 32000. However, I've gotten larger responses.
		CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || "64000",
		// Disable telemetry, auto-updater and error reporting.
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC || "1",
		DISABLE_NON_ESSENTIAL_MODEL_CALLS: process.env.DISABLE_NON_ESSENTIAL_MODEL_CALLS || "1",
		MAX_THINKING_TOKENS: (thinkingBudgetTokens || 0).toString(),
	}

	// We don't want to consume the user's ANTHROPIC_API_KEY,
	// and will allow Claude Code to resolve auth by itself
	delete env["ANTHROPIC_API_KEY"]

	const claudeCodeProcess = execa(claudePath, args, {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env,
		cwd,
		maxBuffer: BUFFER_SIZE,
		timeout: CLAUDE_CODE_TIMEOUT,
	})

	claudeCodeProcess.stdin.write(JSON.stringify(messages))
	claudeCodeProcess.stdin.end()

	return claudeCodeProcess
}

function parseChunk(data: string, processState: ProcessState) {
	if (processState.partialData) {
		processState.partialData += data

		const chunk = attemptParseChunk(processState.partialData)

		if (!chunk) {
			return null
		}

		processState.partialData = null
		return chunk
	}

	const chunk = attemptParseChunk(data)

	if (!chunk) {
		processState.partialData = data
	}

	return chunk
}

function attemptParseChunk(data: string): ClaudeCodeMessage | null {
	try {
		return JSON.parse(data)
	} catch (error) {
		console.error("Error parsing chunk:", error, data.length)
		return null
	}
}
