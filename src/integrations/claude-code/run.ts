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

export async function* runClaudeCode(options: ClaudeCodeOptions): AsyncGenerator<ClaudeCodeMessage> {
	const process = runProcess(options)

	const rl = readline.createInterface({
		input: process.stdout,
	})

	let error: Error | null = null
	let errorOutput = ""
	let exitCode: number | null = null

	process.stderr.on("data", (data) => {
		errorOutput += data.toString()
	})

	process.on("close", (code) => {
		exitCode = code
	})

	process.on("error", (err) => {
		error = err
	})

	try {
		const dataQueue: ClaudeCodeMessage[] = []

		rl.on("line", (line) => {
			if (error) {
				throw error
			}

			try {
				if (!line.trim()) {
					return
				}

				const message = JSON.parse(line) as ClaudeCodeMessage
				dataQueue.push(message)
			} catch (err) {
				console.error("Error parsing line:", line, err)
			}
		})

		while (process.exitCode === null || dataQueue.length > 0) {
			if (error) {
				throw error
			}

			const data = dataQueue.shift()
			if (!data) {
				await new Promise((resolve) => setTimeout(resolve, 10))
				continue
			}

			yield data
		}

		const { exitCode } = await process
		if (exitCode !== null && exitCode !== 0) {
			errorOutput = errorOutput.trim()
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
