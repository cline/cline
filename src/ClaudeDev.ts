import { Anthropic } from "@anthropic-ai/sdk"
import defaultShell from "default-shell"
import * as diff from "diff"
import { execa } from "execa"
import fs from "fs/promises"
import { glob } from "glob"
import osName from "os-name"
import * as path from "path"
import { serializeError } from "serialize-error"
import { DEFAULT_MAX_REQUESTS_PER_TASK } from "./shared/Constants"
import { Tool, ToolName } from "./shared/Tool"
import { ClaudeAsk, ClaudeSay, ClaudeSayTool, ExtensionMessage } from "./shared/ExtensionMessage"
import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import { ClaudeAskResponse } from "./shared/WebviewMessage"
import { SidebarProvider } from "./providers/SidebarProvider"
import { ClaudeRequestResult } from "./shared/ClaudeRequestResult"

const SYSTEM_PROMPT = `You are Claude Dev, a highly skilled software developer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.

====
 
CAPABILITIES

- You can read and analyze code in various programming languages, and can write clean, efficient, and well-documented code.
- You can debug complex issues and providing detailed explanations, offering architectural insights and design patterns.
- You have access to tools that let you execute CLI commands on the user's computer, list files in a directory, read and write files, and ask follow-up questions. These tools help you effectively accomplish a wide range of tasks, such as writing code, making edits or improvements to existing files, understanding the current state of a project, performing system operations, and much more.
    - For example, when asked to make edits or improvements you might use the list_files and read_file tools to examine the contents of relevant files, analyze the code and suggest improvements or make necessary edits, then use the write_to_file tool to implement changes.
- The execute_command tool lets you run commands on the user's computer and should be used whenever you feel it can help accomplish the user's task. When you need to execute a CLI command, you must provide a clear explanation of what the command does. Prefer to execute complex CLI commands over creating executable scripts, since they are more flexible and easier to run.

====

RULES

- Always read a file before editing it if you are missing content. This will help you understand the context and make informed changes.
- When editing files, always provide the complete file content in your response, regardless of the extent of changes. The system handles diff generation automatically.
- Before using the execute_command tool, you must first think about the System Information context provided by the user to understand their environment and tailor your commands to ensure they are compatible with the user's system.
- When using the execute_command tool, avoid running servers or executing commands that don't terminate on their own (e.g. Flask web servers, continuous scripts). If a task requires such a process or server, explain in your task completion result why you can't execute it directly and provide clear instructions on how the user can run it themselves.
- When creating a new project (such as an app, website, or any software project), unless the user specifies otherwise, organize all new files within a dedicated project directory. Use appropriate file paths when writing files, as the write_to_file tool will automatically create any necessary directories. Structure the project logically, adhering to best practices for the specific type of project being created. Unless otherwise specified, new projects should be easily run without additional setup, for example most projects can be built in HTML, CSS, and JavaScript - which you can open in a browser.
- You must try to use multiple tools in one request when possible. For example if you were to create a website, you would use the write_to_file tool to create the necessary files with their appropriate contents all at once. Or if you wanted to analyze a project, you could use the read_file tool multiple times to look at several key files. This will help you accomplish the user's task more efficiently.
- Be sure to consider the type of project (e.g. Python, JavaScript, web application) when determining the appropriate structure and files to include. Also consider what files may be most relevant to accomplishing the task, for example looking at a project's manifest file would help you understand the project's dependencies, which you could incorporate into any code you write.
- When making changes to code, always consider the context in which the code is being used. Ensure that your changes are compatible with the existing codebase and that they follow the project's coding standards and best practices.
- Do not ask for more information than necessary. Use the tools provided to accomplish the user's request efficiently and effectively. When you've completed your task, you must use the attempt_completion tool to present the result to the user. The user may provide feedback, which you can use to make improvements and try again.
- You are only allowed to ask the user questions using the ask_followup_question tool. Use this tool only when you need additional details to complete a task, and be sure to use a clear and concise question that will help you move forward with the task.
- Your goal is to try to accomplish the user's task, NOT engage in a back and forth conversation.
- NEVER end completion_attempt with a question or request to engage in further conversation! Formulate the end of your result in a way that is final and does not require further input from the user. 
- NEVER start your responses with affirmations like "Certaintly", "Okay", "Sure", "Great", etc. You should NOT be conversational in your responses, but rather direct and to the point.

====

OBJECTIVE

You accomplish a given task iteratively, breaking it down into clear steps and working through them methodically.

1. Analyze the user's task and set clear, achievable goals to accomplish it. Prioritize these goals in a logical order.
2. Work through these goals sequentially, utilizing available tools as necessary. Each goal should correspond to a distinct step in your problem-solving process.
3. Remember, you have extensive capabilities with access to a wide range of tools that can be used in powerful and clever ways as necessary to accomplish each goal. Before calling a tool, do some analysis within <thinking></thinking> tags. First, think about which of the provided tools is the relevant tool to answer the user's request. Second, go through each of the required parameters of the relevant tool and determine if the user has directly provided or given enough information to infer a value. When deciding if the parameter can be inferred, carefully consider all the context to see if it supports a specific value. If all of the required parameters are present or can be reasonably inferred, close the thinking tag and proceed with the tool call. BUT, if one of the values for a required parameter is missing, DO NOT invoke the function (not even with fillers for the missing params) and instead, ask the user to provide the missing parameters using the ask_followup_question tool. DO NOT ask for more information on optional parameters if it is not provided.
4. Once you've completed the user's task, you must use the attempt_completion tool to present the result of the task to the user. You may also provide a CLI command to showcase the result of your task; this can be particularly useful for web development tasks, where you can run \`open -a "Google Chrome" index.html\` to show the website you've built. Avoid commands that run indefinitely (like servers). Instead, if such a command is needed, include instructions for the user to run it in the 'result' parameter.
5. The user may provide feedback, which you can use to make improvements and try again. But DO NOT continue in pointless back and forth conversations, i.e. don't end your responses with questions or offers for further assistance.
`

const tools: Tool[] = [
	{
		name: "execute_command",
		description:
			"Execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. Do not run servers or commands that don't terminate on their own. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run.",
		input_schema: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description:
						"The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions. Avoid commands that run indefinitely (like servers) that don't terminate on their own.",
				},
			},
			required: ["command"],
		},
	},
	{
		name: "list_files",
		description:
			"List all files and directories at the top level of the specified directory. Use this to understand the contents and structure of a directory by examining file names and extensions. This information can guide decision-making on which files to process or which subdirectories to explore further. To investigate subdirectories, call this tool again with the path of the subdirectory.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"The path of the directory to list contents for. Do not use absolute paths or attempt to access directories outside of the current working directory.",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "read_file",
		description:
			"Read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file, for example to analyze code, review text files, or extract information from configuration files. Be aware that this tool may not be suitable for very large files or binary files, as it returns the raw content as a string.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"The path of the file to read. Do not use absolute paths or attempt to access files outside of the current working directory.",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "write_to_file",
		description:
			"Write content to a file at the specified path. If the file exists, only the necessary changes will be applied. If the file doesn't exist, it will be created. Always provide the full intended content of the file. This tool will automatically create any directories needed to write the file.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"The path of the file to write to. Do not use absolute paths or attempt to write to files outside of the current working directory.",
				},
				content: {
					type: "string",
					description: "The full content to write to the file",
				},
			},
			required: ["path", "content"],
		},
	},
	{
		name: "ask_followup_question",
		description:
			"Ask the user a question to gather additional information needed to complete the task. This tool should be used when you encounter ambiguities, need clarification, or require more details to proceed effectively. It allows for interactive problem-solving by enabling direct communication with the user. Use this tool judiciously to maintain a balance between gathering necessary information and avoiding excessive back-and-forth.",
		input_schema: {
			type: "object",
			properties: {
				question: {
					type: "string",
					description:
						"The question to ask the user. This should be a clear, specific question that addresses the information you need.",
				},
			},
			required: ["question"],
		},
	},
	{
		name: "attempt_completion",
		description:
			"Once you've completed the task, use this tool to present the result to the user. They may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.",
		input_schema: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description:
						"The CLI command to execute to show a live demo of the result to the user. For example, use 'open -a \"Google Chrome\" index.html' to display a created website. Avoid commands that run indefinitely (like servers) that don't terminate on their own. Instead, if such a command is needed, include instructions for the user to run it in the 'result' parameter.",
				},
				result: {
					type: "string",
					description:
						"The result of the task. Formulate this result in a way that is final and does not require further input from the user. Don't end your result with questions or offers for further assistance.",
				},
			},
			required: ["result"],
		},
	},
]

export class ClaudeDev {
	private client: Anthropic
	private conversationHistory: Anthropic.MessageParam[] = []
	private maxRequestsPerTask: number
	private requestCount = 0
	private askResponse?: ClaudeAskResponse
	private askResponseText?: string
	private providerRef: WeakRef<SidebarProvider>
	abort: boolean = false

	constructor(provider: SidebarProvider, task: string, apiKey: string, maxRequestsPerTask?: number) {
		this.providerRef = new WeakRef(provider)
		this.client = new Anthropic({ apiKey })
		this.maxRequestsPerTask = maxRequestsPerTask ?? DEFAULT_MAX_REQUESTS_PER_TASK

		this.startTask(task)
	}

	updateApiKey(apiKey: string) {
		this.client = new Anthropic({ apiKey })
	}

	updateMaxRequestsPerTask(maxRequestsPerTask: number | undefined) {
		this.maxRequestsPerTask = maxRequestsPerTask ?? DEFAULT_MAX_REQUESTS_PER_TASK
	}

	async handleWebviewAskResponse(askResponse: ClaudeAskResponse, text?: string) {
		this.askResponse = askResponse
		this.askResponseText = text
	}

	async ask(type: ClaudeAsk, question: string): Promise<{ response: ClaudeAskResponse; text?: string }> {
		// If this ClaudeDev instance was aborted by the provider, then the only thing keeping us alive is a promise still running in the background, in which case we don't want to send its result to the webview as it is attached to a new instance of ClaudeDev now. So we can safely ignore the result of any active promises, and this class will be deallocated. (Although we set claudeDev = undefined in provider, that simply removes the reference to this instance, but the instance is still alive until this promise resolves or rejects.)
		if (this.abort) {
			throw new Error("ClaudeDev instance aborted")
		}
		this.askResponse = undefined
		this.askResponseText = undefined
		await this.providerRef.deref()?.addClaudeMessage({ ts: Date.now(), type: "ask", ask: type, text: question })
		await this.providerRef.deref()?.postStateToWebview()
		await pWaitFor(() => this.askResponse !== undefined, { interval: 100 })
		const result = { response: this.askResponse!, text: this.askResponseText }
		this.askResponse = undefined
		this.askResponseText = undefined
		return result
	}

	async say(type: ClaudeSay, text: string): Promise<undefined> {
		if (this.abort) {
			throw new Error("ClaudeDev instance aborted")
		}
		await this.providerRef.deref()?.addClaudeMessage({ ts: Date.now(), type: "say", say: type, text: text })
		await this.providerRef.deref()?.postStateToWebview()
	}

	private async startTask(task: string): Promise<void> {
		// conversationHistory (for API) and claudeMessages (for webview) need to be in sync
		// if the extension process were killed, then on restart the claudeMessages might not be empty, so we need to set it to [] when we create a new ClaudeDev client (otherwise webview would show stale messages from previous session)
		await this.providerRef.deref()?.setClaudeMessages([])
		await this.providerRef.deref()?.postStateToWebview()

		// This first message kicks off a task, it is not included in every subsequent message. This is a good place to give all the relevant context to a task, instead of having Claude request for it using tools.
		let userPrompt = `# Task
\"${task}\"

====

# Auto-generated Context (may or may not be relevant to the task)

## System Information
Operating System: ${osName()}
Default Shell: ${defaultShell}
Current Working Directory: ${process.cwd()}
`
		// If the extension is run without a workspace open, we could be in the root directory which has limited access
		const cwd = process.cwd()
		const root = process.platform === "win32" ? path.parse(cwd).root : "/"
		const isRoot = cwd === root
		if (isRoot) {
			userPrompt += `WARNING: You are currently in the root directory! You DO NOT have read or write permissions in this directory, so you would need to use a command like \`echo $HOME\` to find a path you can work with (e.g. the user\'s Desktop directory). If you cannot accomplish your task in the root directory, you need to tell the user to open this extension in another directory (since you are a script being run in a VS Code extension).
`
		} else {
			const filesInCurrentDir = await this.listFiles(".", false)
			userPrompt += `
## Files in Current Directory
${filesInCurrentDir}
`
		}

		// we want to use visibleTextEditors and not activeTextEditor since we are a sidebar extension and take focus away from the text editor
		const openDocuments = vscode.window.visibleTextEditors
			.map(
				(editor) => `
Path: ${editor.document.uri}
Contents:
${editor.document.getText()}}`
			)
			.join("\n")
		if (openDocuments) {
			userPrompt += `
## Files that user has open in VS Code
${openDocuments}`
		}

		await this.say("text", task)

		let totalInputTokens = 0
		let totalOutputTokens = 0

		while (this.requestCount < this.maxRequestsPerTask) {
			const { didCompleteTask, inputTokens, outputTokens } = await this.recursivelyMakeClaudeRequests([
				{ type: "text", text: userPrompt },
			])
			totalInputTokens += inputTokens
			totalOutputTokens += outputTokens

			//  The way this agentic loop works is that claude will be given a task that he then calls tools to complete. unless there's an attempt_completion call, we keep responding back to him with his tool's responses until he either attempt_completion or does not use anymore tools. If he does not use anymore tools, we ask him to consider if he's completed the task and then call attempt_completion, otherwise proceed with completing the task.
			// There is a MAX_REQUESTS_PER_TASK limit to prevent infinite requests, but Claude is prompted to finish the task as efficiently as he can.

			//const totalCost = this.calculateApiCost(totalInputTokens, totalOutputTokens)
			if (didCompleteTask) {
				//this.say("task_completed", `Task completed. Total API usage cost: ${totalCost}`)
				break
			} else {
				// this.say(
				// 	"tool",
				// 	"Claude responded with only text blocks but has not called attempt_completion yet. Forcing him to continue with task..."
				// )
				userPrompt =
					"Ask yourself if you have completed the user's task. If you have, use the attempt_completion tool, otherwise proceed to the next step. (This is an automated message, so do not respond to it conversationally. Just proceed with the task.)"
			}
		}
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

	// Calculates cost of a Claude 3.5 Sonnet API request
	calculateApiCost(inputTokens: number, outputTokens: number): number {
		const INPUT_COST_PER_MILLION = 3.0 // $3 per million input tokens
		const OUTPUT_COST_PER_MILLION = 15.0 // $15 per million output tokens
		const inputCost = (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION
		const outputCost = (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION
		const totalCost = inputCost + outputCost
		return totalCost
	}

	async writeToFile(filePath: string, newContent: string): Promise<string> {
		try {
			const fileExists = await fs
				.access(filePath)
				.then(() => true)
				.catch(() => false)
			if (fileExists) {
				const originalContent = await fs.readFile(filePath, "utf-8")
				const diffResult = diff.createPatch(filePath, originalContent, newContent)
				if (diffResult) {
					await fs.writeFile(filePath, newContent)

					// Create diff for DiffCodeView.tsx
					const diffStringRaw = diff.diffLines(originalContent, newContent)
					const diffStringConverted = diffStringRaw
						.map((part, index) => {
							const prefix = part.added ? "+ " : part.removed ? "- " : "  "
							return part.value
								.split("\n")
								.map((line, lineIndex) => {
									// avoid adding an extra empty line at the very end of the diff output
									if (
										line === "" &&
										index === diffStringRaw.length - 1 &&
										lineIndex === part.value.split("\n").length - 1
									) {
										return null
									}
									return prefix + line + "\n"
								})
								.join("")
						})
						.join("")
					this.say(
						"tool",
						JSON.stringify({
							tool: "editedExistingFile",
							path: filePath,
							diff: diffStringConverted,
						} as ClaudeSayTool)
					)

					return `Changes applied to ${filePath}:\n${diffResult}`
				} else {
					this.say(
						"tool",
						JSON.stringify({
							tool: "editedExistingFile",
							path: filePath,
							content: "No changes.",
						} as ClaudeSayTool)
					)
					return `Tool succeeded, however there were no changes detected to ${filePath}`
				}
			} else {
				await fs.mkdir(path.dirname(filePath), { recursive: true })
				await fs.writeFile(filePath, newContent)
				this.say(
					"tool",
					JSON.stringify({ tool: "newFileCreated", path: filePath, content: newContent } as ClaudeSayTool)
				)
				return `New file created and content written to ${filePath}`
			}
		} catch (error) {
			const errorString = `Error writing file: ${JSON.stringify(serializeError(error))}`
			this.say("error", `Error writing file:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`)
			return errorString
		}
	}

	async readFile(filePath: string): Promise<string> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			this.say("tool", JSON.stringify({ tool: "readFile", path: filePath, content } as ClaudeSayTool))
			return content
		} catch (error) {
			const errorString = `Error reading file: ${JSON.stringify(serializeError(error))}`
			this.say("error", `Error reading file:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`)
			return errorString
		}
	}

	async listFiles(dirPath: string, shouldLog: boolean = true): Promise<string> {
		const absolutePath = path.resolve(dirPath)
		const root = process.platform === "win32" ? path.parse(absolutePath).root : "/"
		const isRoot = absolutePath === root
		if (isRoot) {
			if (shouldLog) {
				this.say("tool", JSON.stringify({ tool: "listFiles", path: dirPath, content: root } as ClaudeSayTool))
			}
			return root
		}

		try {
			const options = {
				cwd: dirPath,
				dot: true, // Allow patterns to match files/directories that start with '.', even if the pattern does not start with '.'
				mark: true, // Append a / on any directories matched
			}
			// * globs all files in one dir, ** globs files in nested directories
			const entries = await glob("*", options)
			const result = entries.slice(0, 500).join("\n") // truncate to 500 entries
			if (shouldLog) {
				this.say("tool", JSON.stringify({ tool: "listFiles", path: dirPath, content: result } as ClaudeSayTool))
			}
			return result
		} catch (error) {
			const errorString = `Error listing files and directories: ${JSON.stringify(serializeError(error))}`
			this.say(
				"error",
				`Error listing files and directories:\n${
					error.message ?? JSON.stringify(serializeError(error), null, 2)
				}`
			)
			return errorString
		}
	}

	async executeCommand(command: string): Promise<string> {
		const { response } = await this.ask("command", command)
		if (response !== "yesButtonTapped") {
			return "Command execution was not approved by the user."
		}
		try {
			let result = ""
			// execa by default tries to convery bash into javascript
			// by using shell: true we use sh on unix or cmd.exe on windows
			// also worth noting that execa`input` runs commands and the execa() creates a new instance
			for await (const line of execa({ shell: true })`${command}`) {
				this.say("command_output", line) // stream output to user in realtime
				result += `${line}\n`
			}
			return `Command executed successfully. Output:\n${result}`
		} catch (e) {
			const error = e as any
			let errorMessage = error.message || JSON.stringify(serializeError(error), null, 2)
			const errorString = `Error executing command:\n${errorMessage}`
			this.say("error", `Error executing command:\n${errorMessage}`) // TODO: in webview show code block for command errors
			return errorString
		}
	}

	async askFollowupQuestion(question: string): Promise<string> {
		const { text } = await this.ask("followup", question)
		return `User's response:\n\"${text}\"`
	}

	async attemptCompletion(result: string, command?: string): Promise<string> {
		let resultToSend = result
		if (command) {
			await this.say("completion_result", resultToSend)
			await this.executeCommand(command)
			resultToSend = ""
		}
		const { response, text } = await this.ask("completion_result", resultToSend) // this prompts webview to show 'new task' button, and enable text input (which would be the 'text' here)
		if (response === "yesButtonTapped") {
			return ""
		}
		return `The user is not pleased with the results. Use the feedback they provided to successfully complete the task, and then attempt completion again.\nUser's feedback:\n\"${text}\"`
	}

	async recursivelyMakeClaudeRequests(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): Promise<ClaudeRequestResult> {
		if (this.abort) {
			throw new Error("ClaudeDev instance aborted")
		}

		this.conversationHistory.push({ role: "user", content: userContent })
		if (this.requestCount >= this.maxRequestsPerTask) {
			const { response } = await this.ask(
				"request_limit_reached",
				`Claude Dev has reached the maximum number of requests for this task. Would you like to reset the count and allow him to proceed?`
			)

			if (response === "yesButtonTapped") {
				this.requestCount = 0
			} else {
				this.conversationHistory.push({
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Failure: I have reached the request limit for this task. Do you have a new task for me?",
						},
					],
				})
				return { didCompleteTask: true, inputTokens: 0, outputTokens: 0 }
			}
		}

		try {
			// what the user sees in the webview
			await this.say(
				"api_req_started",
				JSON.stringify({
					request: {
						model: "claude-3-5-sonnet-20240620",
						max_tokens: 4096,
						system: "(see SYSTEM_PROMPT in https://github.com/saoudrizwan/claude-dev/src/ClaudeDev.ts)",
						messages: [{ conversation_history: "..." }, { role: "user", content: userContent }],
						tools: "(see tools in https://github.com/saoudrizwan/claude-dev/src/ClaudeDev.ts)",
						tool_choice: { type: "auto" },
					},
				})
			)

			const response = await this.client.messages.create({
				model: "claude-3-5-sonnet-20240620", // https://docs.anthropic.com/en/docs/about-claude/models
				max_tokens: 4096,
				system: SYSTEM_PROMPT,
				messages: this.conversationHistory,
				tools: tools,
				tool_choice: { type: "auto" },
			})
			this.requestCount++

			let assistantResponses: Anthropic.Messages.ContentBlock[] = []
			let inputTokens = response.usage.input_tokens
			let outputTokens = response.usage.output_tokens
			await this.say(
				"api_req_finished",
				JSON.stringify({
					tokensIn: inputTokens,
					tokensOut: outputTokens,
					cost: this.calculateApiCost(inputTokens, outputTokens),
				})
			)

			// A response always returns text content blocks (it's just that before we were iterating over the completion_attempt response before we could append text response, resulting in bug)
			for (const contentBlock of response.content) {
				if (contentBlock.type === "text") {
					assistantResponses.push(contentBlock)
					await this.say("text", contentBlock.text)
				}
			}

			let toolResults: Anthropic.ToolResultBlockParam[] = []
			let attemptCompletionBlock: Anthropic.Messages.ToolUseBlock | undefined
			for (const contentBlock of response.content) {
				if (contentBlock.type === "tool_use") {
					assistantResponses.push(contentBlock)
					const toolName = contentBlock.name as ToolName
					const toolInput = contentBlock.input
					const toolUseId = contentBlock.id
					if (toolName === "attempt_completion") {
						attemptCompletionBlock = contentBlock
					} else {
						const result = await this.executeTool(toolName, toolInput)
						// this.say(
						// 	"tool",
						// 	`\nTool Used: ${toolName}\nTool Input: ${JSON.stringify(toolInput)}\nTool Result: ${result}`
						// )
						toolResults.push({ type: "tool_result", tool_use_id: toolUseId, content: result })
					}
				}
			}

			if (assistantResponses.length > 0) {
				this.conversationHistory.push({ role: "assistant", content: assistantResponses })
			} else {
				// this should never happen! it there's no assistant_responses, that means we got no text or tool_use content blocks from API which we should assume is an error
				this.say("error", "Unexpected Error: No assistant messages were found in the API response")
				this.conversationHistory.push({
					role: "assistant",
					content: [{ type: "text", text: "Failure: I did not have a response to provide." }],
				})
			}

			let didCompleteTask = false

			// attempt_completion is always done last, since there might have been other tools that needed to be called first before the job is finished
			// it's important to note that claude will order the tools logically in most cases, so we don't have to think about which tools make sense calling before others
			if (attemptCompletionBlock) {
				let result = await this.executeTool(
					attemptCompletionBlock.name as ToolName,
					attemptCompletionBlock.input
				)
				// this.say(
				// 	"tool",
				// 	`\nattempt_completion Tool Used: ${attemptCompletionBlock.name}\nTool Input: ${JSON.stringify(
				// 		attemptCompletionBlock.input
				// 	)}\nTool Result: ${result}`
				// )
				if (result === "") {
					didCompleteTask = true
					result = "The user is satisfied with the result."
				}
				toolResults.push({ type: "tool_result", tool_use_id: attemptCompletionBlock.id, content: result })
			}

			if (toolResults.length > 0) {
				if (didCompleteTask) {
					this.conversationHistory.push({ role: "user", content: toolResults })
					this.conversationHistory.push({
						role: "assistant",
						content: [
							{
								type: "text",
								text: "I am pleased you are satisfied with the result. Do you have a new task for me?",
							},
						],
					})
				} else {
					const {
						didCompleteTask: recDidCompleteTask,
						inputTokens: recInputTokens,
						outputTokens: recOutputTokens,
					} = await this.recursivelyMakeClaudeRequests(toolResults)
					didCompleteTask = recDidCompleteTask
					inputTokens += recInputTokens
					outputTokens += recOutputTokens
				}
			}

			return { didCompleteTask, inputTokens, outputTokens }
		} catch (error) {
			// only called if the API request fails (executeTool errors are returned back to claude)
			this.say("error", `API request failed:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`)
			return { didCompleteTask: true, inputTokens: 0, outputTokens: 0 }
		}
	}
}
