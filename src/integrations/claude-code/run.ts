import * as vscode from "vscode"
import Anthropic from "@anthropic-ai/sdk"
import { execa } from "execa"

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)

export function runClaudeCode({
	systemPrompt,
	messages,
	path,
}: {
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	path?: string
}) {
	const claudePath = path || "claude"

	// TODO: Is it worh using sessions? Where do we store the session ID?
	const args = ["-p", JSON.stringify(messages), "--system-prompt", systemPrompt, "--verbose", "--output-format", "stream-json"]

	return execa(claudePath, args, {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
		cwd,
	})
}
