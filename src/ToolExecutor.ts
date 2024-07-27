import { ClaudeDev } from "./ClaudeDev"
import { ToolName } from "./shared/Tool"
import fs from "fs/promises"
import path from "path"
import { glob } from "glob"
import { execa } from "execa"
import { serializeError } from "serialize-error"
import * as diff from "diff"
import { ClaudeSayTool } from "./shared/ExtensionMessage"

export class ToolExecutor {
	private claudeDev: ClaudeDev

	constructor(claudeDev: ClaudeDev) {
		this.claudeDev = claudeDev
	}

	async executeTool(toolName: ToolName, toolInput: any): Promise<string> {
		switch (toolName) {
			case "write_to_file":
				return this.writeToFile(toolInput.path, toolInput.content)
			case "read_file":
				return this.readFile(toolInput.path)
			case "list_files":
				return this.listFiles(toolInput.path)
			case "execute_command":
				return this.executeCommand(toolInput.command)
			case "ask_followup_question":
				return this.askFollowupQuestion(toolInput.question)
			case "attempt_completion":
				return this.attemptCompletion(toolInput.result, toolInput.command)
			default:
				return `Unknown tool: ${toolName}`
		}
	}

	private async writeToFile(filePath: string, newContent: string): Promise<string> {
		try {
			const fileExists = await fs
				.access(filePath)
				.then(() => true)
				.catch(() => false)
			if (fileExists) {
				const originalContent = await fs.readFile(filePath, "utf-8")
				const diffResult = diff.createPatch(filePath, originalContent, newContent)
				const completeDiffStringRaw = diff.diffLines(originalContent, newContent)
				const completeDiffStringConverted = completeDiffStringRaw
					.map((part, index) => {
						const prefix = part.added ? "+ " : part.removed ? "- " : "  "
						return (part.value ?? [])
							.split("\n")
							.map((line, lineIndex) => {
								if (
									line === "" &&
									index === completeDiffStringRaw.length - 1 &&
									lineIndex === (part.value ?? []).split("\n").length - 1
								) {
									return null
								}
								return prefix + line + "\n"
							})
							.join("")
					})
					.join("")

				const { response } = await this.claudeDev.ask(
					"tool",
					JSON.stringify({
						tool: "editedExistingFile",
						path: filePath,
						diff: completeDiffStringConverted,
					} as ClaudeSayTool)
				)
				if (response !== "yesButtonTapped") {
					return "This operation was not approved by the user."
				}

				await fs.writeFile(filePath, newContent)
				return `Changes applied to ${filePath}:\n${diffResult}`
			} else {
				const { response } = await this.claudeDev.ask(
					"tool",
					JSON.stringify({ tool: "newFileCreated", path: filePath, content: newContent } as ClaudeSayTool)
				)
				if (response !== "yesButtonTapped") {
					return "This operation was not approved by the user."
				}
				await fs.mkdir(path.dirname(filePath), { recursive: true })
				await fs.writeFile(filePath, newContent)
				return `New file created and content written to ${filePath}`
			}
		} catch (error) {
			const errorString = `Error writing file: ${JSON.stringify(serializeError(error))}`
			this.claudeDev.say(
				"error",
				`Error writing file:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`
			)
			return errorString
		}
	}

	private async readFile(filePath: string): Promise<string> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			const { response } = await this.claudeDev.ask(
				"tool",
				JSON.stringify({ tool: "readFile", path: filePath, content } as ClaudeSayTool)
			)
			if (response !== "yesButtonTapped") {
				return "This operation was not approved by the user."
			}
			return content
		} catch (error) {
			const errorString = `Error reading file: ${JSON.stringify(serializeError(error))}`
			this.claudeDev.say(
				"error",
				`Error reading file:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`
			)
			return errorString
		}
	}

	private async listFiles(dirPath: string, shouldLog: boolean = true): Promise<string> {
		const absolutePath = path.resolve(dirPath)
		const root = process.platform === "win32" ? path.parse(absolutePath).root : "/"
		const isRoot = absolutePath === root
		if (isRoot) {
			if (shouldLog) {
				const { response } = await this.claudeDev.ask(
					"tool",
					JSON.stringify({ tool: "listFiles", path: dirPath, content: root } as ClaudeSayTool)
				)
				if (response !== "yesButtonTapped") {
					return "This operation was not approved by the user."
				}
			}
			return root
		}

		try {
			const options = {
				cwd: dirPath,
				dot: true,
				mark: true,
			}
			const entries = await glob("*", options)
			const result = entries.slice(0, 500).join("\n")
			if (shouldLog) {
				const { response } = await this.claudeDev.ask(
					"tool",
					JSON.stringify({ tool: "listFiles", path: dirPath, content: result } as ClaudeSayTool)
				)
				if (response !== "yesButtonTapped") {
					return "This operation was not approved by the user."
				}
			}
			return result
		} catch (error) {
			const errorString = `Error listing files and directories: ${JSON.stringify(serializeError(error))}`
			this.claudeDev.say(
				"error",
				`Error listing files and directories:\n${
					error.message ?? JSON.stringify(serializeError(error), null, 2)
				}`
			)
			return errorString
		}
	}

	private async executeCommand(command: string): Promise<string> {
		const { response } = await this.claudeDev.ask("command", command)
		if (response !== "yesButtonTapped") {
			return "Command execution was not approved by the user."
		}
		try {
			let result = ""
			for await (const line of execa({ shell: true })`${command}`) {
				this.claudeDev.say("command_output", line)
				result += `${line}\n`
			}
			return `Command executed successfully. Output:\n${result}`
		} catch (e) {
			const error = e as any
			let errorMessage = error.message || JSON.stringify(serializeError(error), null, 2)
			const errorString = `Error executing command:\n${errorMessage}`
			this.claudeDev.say("error", `Error executing command:\n${errorMessage}`)
			return errorString
		}
	}

	private async askFollowupQuestion(question: string): Promise<string> {
		const { text } = await this.claudeDev.ask("followup", question)
		await this.claudeDev.say("user_feedback", text ?? "")
		return `User's response:\n\"${text}\"`
	}

	private async attemptCompletion(result: string, command?: string): Promise<string> {
		let resultToSend = result
		if (command) {
			await this.claudeDev.say("completion_result", resultToSend)
			await this.executeCommand(command)
			resultToSend = ""
		}
		const { response, text } = await this.claudeDev.ask("completion_result", resultToSend)
		if (response === "yesButtonTapped") {
			return ""
		}
		await this.claudeDev.say("user_feedback", text ?? "")
		return `The user is not pleased with the results. Use the feedback they provided to successfully complete the task, and then attempt completion again.\nUser's feedback:\n\"${text}\"`
	}
}
