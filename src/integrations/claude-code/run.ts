import * as vscode from "vscode"
import Anthropic from "@anthropic-ai/sdk"
import { spawn } from "child_process"
import { execa } from "execa"
import { ClaudeCodeMessage } from "./types"
import readline from "readline"

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
	errorOutput: string
	exitCode: number | null
}

export async function* runClaudeCode(options: ClaudeCodeOptions): AsyncGenerator<ClaudeCodeMessage> {
	const process = runProcess(options)

	const rl = readline.createInterface({
		input: process.stdout,
	})

	const processState: ProcessState = {
		error: null,
		errorOutput: "",
		exitCode: null,
		partialData: null,
	}

	process.stderr.on("data", (data) => {
		processState.errorOutput += data.toString()
	})

	process.on("close", (code) => {
		processState.exitCode = code
	})

	process.on("error", (err) => {
		processState.error = err
	})

	try {
		const dataQueue: string[] = []

		rl.on("line", (line) => {
			if (processState.error) {
				throw processState.error
			}

			if (!line.trim()) {
				return
			}

			dataQueue.push(line)
		})

		while (process.exitCode === null || dataQueue.length > 0) {
			if (processState.error) {
				throw processState.error
			}

			const data = dataQueue.shift()
			if (!data) {
				await new Promise((resolve) => setTimeout(resolve, 10))
				continue
			}

			const chunk = parseChunk(data, processState)

			if (!chunk) {
				continue
			}

			yield chunk
		}

		const { exitCode } = await process
		if (exitCode !== null && exitCode !== 0) {
			const errorOutput = processState.errorOutput?.trim()
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

// We want the model to make use of the existing tool format,
// so we disallow the built-in tools
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

function runProcess({ systemPrompt, messages, path, modelId }: ClaudeCodeOptions) {
	const claudePath = path || "claude"

	const args = [
		"-p",
		JSON.stringify(messages),
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

	return execa(claudePath, args, {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
		cwd,
		buffer: false,
	})
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
		console.error("Error parsing chunk:", error)
		return null
	}
}
