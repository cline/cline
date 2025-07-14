import * as vscode from "vscode"
import type Anthropic from "@anthropic-ai/sdk"
import { execa } from "execa"
import { ClaudeCodeMessage } from "./types"
import readline from "readline"
import { CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS } from "@roo-code/types"
import * as os from "os"

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)

type ClaudeCodeOptions = {
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	path?: string
	modelId?: string
}

type ProcessState = {
	partialData: string | null
	error: Error | null
	stderrLogs: string
	exitCode: number | null
}

export async function* runClaudeCode(
	options: ClaudeCodeOptions & { maxOutputTokens?: number },
): AsyncGenerator<ClaudeCodeMessage | string> {
	const process = runProcess(options)

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

function runProcess({
	systemPrompt,
	messages,
	path,
	modelId,
	maxOutputTokens,
}: ClaudeCodeOptions & { maxOutputTokens?: number }) {
	const claudePath = path || "claude"
	const isWindows = os.platform() === "win32"

	// Build args based on platform
	const args = ["-p"]

	// Pass system prompt as flag on non-Windows, via stdin on Windows (avoids cmd length limits)
	if (!isWindows) {
		args.push("--system-prompt", systemPrompt)
	}

	args.push(
		"--verbose",
		"--output-format",
		"stream-json",
		"--disallowedTools",
		claudeCodeTools,
		// Roo Code will handle recursive calls
		"--max-turns",
		"1",
	)

	if (modelId) {
		args.push("--model", modelId)
	}

	const child = execa(claudePath, args, {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			// Use the configured value, or the environment variable, or default to CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS
			CLAUDE_CODE_MAX_OUTPUT_TOKENS:
				maxOutputTokens?.toString() ||
				process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ||
				CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS.toString(),
		},
		cwd,
		maxBuffer: 1024 * 1024 * 1000,
		timeout: CLAUDE_CODE_TIMEOUT,
	})

	// Prepare stdin data: Windows gets both system prompt & messages (avoids 8191 char limit),
	// other platforms get messages only (avoids Linux E2BIG error from ~128KiB execve limit)
	let stdinData: string
	if (isWindows) {
		stdinData = JSON.stringify({
			systemPrompt,
			messages,
		})
	} else {
		stdinData = JSON.stringify(messages)
	}

	// Use setImmediate to ensure process is spawned before writing (prevents stdin race conditions)
	setImmediate(() => {
		try {
			child.stdin.write(stdinData, "utf8", (error: Error | null | undefined) => {
				if (error) {
					console.error("Error writing to Claude Code stdin:", error)
					child.kill()
				}
			})
			child.stdin.end()
		} catch (error) {
			console.error("Error accessing Claude Code stdin:", error)
			child.kill()
		}
	})

	return child
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
