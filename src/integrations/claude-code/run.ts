import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type Anthropic from "@anthropic-ai/sdk"
import { RuntimeShimWrapper } from "@/core/api/runtime/shim-wrapper"
import { Logger } from "@/shared/services/Logger"
import { getCwd } from "@/utils/path"
import { ClaudeCodeStreamTranslator } from "./stream-translator"
import { ClaudeCodeMessage } from "./types"

type ClaudeCodeOptions = {
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	path?: string
	modelId: string
	thinkingBudgetTokens?: number
	shouldUseFile?: boolean
}

// The maximum argument length is longer than this,
// but environment variables and other factors can reduce it.
// We use a conservative limit to avoid issues while supporting older Claude Code versions that don't support file input.
export const MAX_SYSTEM_PROMPT_LENGTH = 65536

export async function* runClaudeCode(options: ClaudeCodeOptions): AsyncGenerator<ClaudeCodeMessage | string> {
	const isSystemPromptTooLong = options.systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH
	const uniqueId = crypto.randomUUID()
	const tempFilePath = path.join(os.tmpdir(), `cline-system-prompt-${uniqueId}.txt`)
	if (os.platform() === "win32" || isSystemPromptTooLong) {
		// Use a temporary file to prevent ENAMETOOLONG and E2BIG errors
		// https://github.com/anthropics/claude-code/issues/3411#issuecomment-3082068547
		await fs.writeFile(tempFilePath, options.systemPrompt, "utf8")
		options.systemPrompt = tempFilePath
		options.shouldUseFile = true
	}

	const shim = new RuntimeShimWrapper()
	const streamTranslator = new ClaudeCodeStreamTranslator()

	try {
		for await (const chunk of shim.execute(
			{
				command: options.path?.trim() || "claude",
				args: buildClaudeCodeArgs(options),
				cwd: await getCwd(),
				env: buildClaudeCodeEnv(options.thinkingBudgetTokens),
				stdinPayload: JSON.stringify(options.messages),
				maxBufferBytes: BUFFER_SIZE,
				timeoutMs: CLAUDE_CODE_TIMEOUT,
			},
			streamTranslator,
		)) {
			yield chunk
		}
	} catch (err) {
		Logger.error(`Error during Claude Code execution:`, err)

		const stderrLogs = err instanceof Error && "stderrOutput" in err ? String((err as any).stderrOutput ?? "") : ""
		if (stderrLogs.includes("unknown option '--system-prompt-file'")) {
			throw new Error(`The Claude Code executable is outdated. Please update it to the latest version.`, {
				cause: err,
			})
		}

		if (err instanceof Error) {
			if (err.message.includes("ENOENT")) {
				throw new Error(
					`Failed to find the Claude Code executable.
Make sure it's installed and available in your PATH or properly set in your provider settings.`,
					{ cause: err },
				)
			}

			if (err.message.includes("E2BIG")) {
				throw new Error(
					`Executing Claude Code failed due to a long system prompt. The maximum argument length is 131072 bytes. 
Rules and workflows contribute to a longer system prompt, consider disabling some of them temporarily to reduce the length.
Anthropic is aware of this issue and is considering a fix: https://github.com/anthropics/claude-code/issues/3411.
`,
					{ cause: err },
				)
			}

			if (err.message.includes("ENAMETOOLONG")) {
				throw new Error(
					`Executing Claude Code failed due to a long system prompt. Windows has a limit of 8191 characters, which makes the integration with Cline not work properly.
Please check our docs on how to integrate Claude Code with Cline on Windows: https://docs.cline.bot/provider-config/claude-code#windows-setup.
Anthropic is aware of this issue and is considering a fix: https://github.com/anthropics/claude-code/issues/3411.
`,
					{ cause: err },
				)
			}

			// When the command fails, execa throws an error with the arguments, which include the whole system prompt.
			// We want to log that, but not show it to the user.
			const startOfCommand = err.message.indexOf(": ")
			if (startOfCommand !== -1) {
				const messageWithoutCommand = err.message.slice(0, startOfCommand).trim()

				throw new Error(`${messageWithoutCommand}\n${stderrLogs.trim()}`, { cause: err })
			}
		}

		throw err
	} finally {
		if (options.shouldUseFile) {
			fs.unlink(tempFilePath).catch(Logger.error)
		}
	}
}

// We want the model to use our custom tool format instead of built-in tools.
// Disabling built-in tools prevents tool-only responses and ensures text output.
// This list must be kept in sync with the tools reported by `claude --output-format stream-json`.
const claudeCodeTools = [
	"Task",
	"TaskOutput",
	"Bash",
	"Glob",
	"Grep",
	"Read",
	"Edit",
	"Write",
	"NotebookEdit",
	"WebFetch",
	"TodoWrite",
	"WebSearch",
	"TaskStop",
	"AskUserQuestion",
	"Skill",
	"EnterPlanMode",
	"ExitPlanMode",
	"EnterWorktree",
	"ExitWorktree",
	"CronCreate",
	"CronDelete",
	"CronList",
	"ToolSearch",
].join(",")

const CLAUDE_CODE_TIMEOUT = 600000 // 10 minutes
// https://github.com/sindresorhus/execa/blob/main/docs/api.md#optionsmaxbuffer
const BUFFER_SIZE = 20_000_000 // 20 MB

// This is the limit imposed by the CLI
const CLAUDE_CODE_MAX_OUTPUT_TOKENS = "32000"

const buildClaudeCodeArgs = ({ systemPrompt, modelId, shouldUseFile }: ClaudeCodeOptions) => [
	shouldUseFile ? "--system-prompt-file" : "--system-prompt",
	systemPrompt,
	"--verbose",
	"--output-format",
	"stream-json",
	"--disallowedTools",
	claudeCodeTools,
	// Cline will handle recursive calls
	"--max-turns",
	"1",
	"--model",
	modelId,
	"-p",
]

const buildClaudeCodeEnv = (thinkingBudgetTokens?: number): NodeJS.ProcessEnv => {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		// Respect the user's environment variables but set defaults.
		CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || CLAUDE_CODE_MAX_OUTPUT_TOKENS,
		// Disable telemetry, auto-updater and error reporting.
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC || "1",
		DISABLE_NON_ESSENTIAL_MODEL_CALLS: process.env.DISABLE_NON_ESSENTIAL_MODEL_CALLS || "1",
		MAX_THINKING_TOKENS: (thinkingBudgetTokens || 0).toString(),
	}

	// We don't want to consume the user's ANTHROPIC_API_KEY,
	// and will allow Claude Code to resolve auth by itself
	delete env["ANTHROPIC_API_KEY"]
	return env
}
