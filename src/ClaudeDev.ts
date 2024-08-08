import { Anthropic } from "@anthropic-ai/sdk"
import defaultShell from "default-shell"
import * as diff from "diff"
import { execa, ExecaError, ResultPromise } from "execa"
import fs from "fs/promises"
import os from "os"
import osName from "os-name"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { serializeError } from "serialize-error"
import treeKill from "tree-kill"
import * as vscode from "vscode"
import { ApiHandler, buildApiHandler } from "./api"
import { listFiles, parseSourceCodeForDefinitionsTopLevel } from "./parse-source-code"
import { ClaudeDevProvider } from "./providers/ClaudeDevProvider"
import { ApiConfiguration } from "./shared/api"
import { ClaudeRequestResult } from "./shared/ClaudeRequestResult"
import { DEFAULT_MAX_REQUESTS_PER_TASK } from "./shared/Constants"
import { ClaudeAsk, ClaudeMessage, ClaudeSay, ClaudeSayTool } from "./shared/ExtensionMessage"
import { Tool, ToolName } from "./shared/Tool"
import { ClaudeAskResponse } from "./shared/WebviewMessage"
import delay from "delay"

const SYSTEM_PROMPT =
	() => `You are Claude Dev, a highly skilled software developer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.

====
 
CAPABILITIES

- You can read and analyze code in various programming languages, and can write clean, efficient, and well-documented code.
- You can debug complex issues and providing detailed explanations, offering architectural insights and design patterns.
- You have access to tools that let you execute CLI commands on the user's computer, list files in a directory (top level or recursively), extract source code definitions, read and write files, and ask follow-up questions. These tools help you effectively accomplish a wide range of tasks, such as writing code, making edits or improvements to existing files, understanding the current state of a project, performing system operations, and much more.
- You can use the list_files_recursive tool to get an overview of the project's file structure, which can provide key insights into the project from directory/file names (how developers conceptualize and organize their code) or file extensions (the language used). The list_files_top_level tool is better suited for generic directories you don't necessarily need the nested structure of, like the Desktop.
- You can use the view_source_code_definitions_top_level tool to get an overview of source code definitions for all files at the top level of a specified directory. This can be particularly useful when you need to understand the broader context and relationships between certain parts of the code. You may need to call this tool multiple times to understand various parts of the codebase related to the task.
	- For example, when asked to make edits or improvements you might use list_files_recursive to get an overview of the project's file structure, then view_source_code_definitions_top_level to get an overview of source code definitions for files located in relevant directories, then read_file to examine the contents of relevant files, analyze the code and suggest improvements or make necessary edits, then use the write_to_file tool to implement changes.
- The execute_command tool lets you run commands on the user's computer and should be used whenever you feel it can help accomplish the user's task. When you need to execute a CLI command, you must provide a clear explanation of what the command does. Prefer to execute complex CLI commands over creating executable scripts, since they are more flexible and easier to run. Interactive and long-running commands are allowed, since the user has the ability to send input to stdin and terminate the command on their own if needed.

====

RULES

- Your current working directory is: ${cwd}
- You cannot \`cd\` into a different directory to complete a task. You are stuck operating from '${cwd}', so be sure to pass in the correct 'path' parameter when using tools that require a path.
- Do not use the ~ character or $HOME to refer to the home directory.
- Before using the execute_command tool, you must first think about the SYSTEM INFORMATION context provided to understand the user's environment and tailor your commands to ensure they are compatible with their system.
- When editing files, always provide the complete file content in your response, regardless of the extent of changes. The system handles diff generation automatically.
- If you need to read or edit a file you have already read or edited, you can assume its contents have not changed since then (unless specified otherwise by the user) and skip using the read_file tool before proceeding.
- When creating a new project (such as an app, website, or any software project), organize all new files within a dedicated project directory unless the user specifies otherwise. Use appropriate file paths when writing files, as the write_to_file tool will automatically create any necessary directories. Structure the project logically, adhering to best practices for the specific type of project being created. Unless otherwise specified, new projects should be easily run without additional setup, for example most projects can be built in HTML, CSS, and JavaScript - which you can open in a browser.
- You must try to use multiple tools in one request when possible. For example if you were to create a website, you would use the write_to_file tool to create the necessary files with their appropriate contents all at once. Or if you wanted to analyze a project, you could use the read_file tool multiple times to look at several key files. This will help you accomplish the user's task more efficiently.
- Be sure to consider the type of project (e.g. Python, JavaScript, web application) when determining the appropriate structure and files to include. Also consider what files may be most relevant to accomplishing the task, for example looking at a project's manifest file would help you understand the project's dependencies, which you could incorporate into any code you write.
- When making changes to code, always consider the context in which the code is being used. Ensure that your changes are compatible with the existing codebase and that they follow the project's coding standards and best practices.
- Do not ask for more information than necessary. Use the tools provided to accomplish the user's request efficiently and effectively. When you've completed your task, you must use the attempt_completion tool to present the result to the user. The user may provide feedback, which you can use to make improvements and try again.
- You are only allowed to ask the user questions using the ask_followup_question tool. Use this tool only when you need additional details to complete a task, and be sure to use a clear and concise question that will help you move forward with the task. However if you can use the available tools to avoid having to ask the user questions, you should do so. For example if you need to know the name of a file, you can use the list files tool to get the name yourself. If the user refers to something vague, you can use the list_files_recursive tool to get a better understanding of the project to see if that helps you clear up any confusion.
- Your goal is to try to accomplish the user's task, NOT engage in a back and forth conversation.
- NEVER end completion_attempt with a question or request to engage in further conversation! Formulate the end of your result in a way that is final and does not require further input from the user. 
- NEVER start your responses with affirmations like "Certaintly", "Okay", "Sure", "Great", etc. You should NOT be conversational in your responses, but rather direct and to the point.
- Feel free to use markdown as much as you'd like in your responses. When using code blocks, always include a language specifier.
- When presented with images, utilize your vision capabilities to thoroughly examine them and extract meaningful information. Incorporate these insights into your thought process as you accomplish the user's task.

====

OBJECTIVE

You accomplish a given task iteratively, breaking it down into clear steps and working through them methodically.

1. Analyze the user's task and set clear, achievable goals to accomplish it. Prioritize these goals in a logical order.
2. Work through these goals sequentially, utilizing available tools as necessary. Each goal should correspond to a distinct step in your problem-solving process. It is okay for certain steps to take multiple iterations, i.e. if you need to create many files but are limited by your max output limitations, it's okay to create a few files at a time as each subsequent iteration will keep you informed on the work completed and what's remaining. 
3. Remember, you have extensive capabilities with access to a wide range of tools that can be used in powerful and clever ways as necessary to accomplish each goal. Before calling a tool, do some analysis within <thinking></thinking> tags. First, think about which of the provided tools is the relevant tool to answer the user's request. Second, go through each of the required parameters of the relevant tool and determine if the user has directly provided or given enough information to infer a value. When deciding if the parameter can be inferred, carefully consider all the context to see if it supports a specific value. If all of the required parameters are present or can be reasonably inferred, close the thinking tag and proceed with the tool call. BUT, if one of the values for a required parameter is missing, DO NOT invoke the function (not even with fillers for the missing params) and instead, ask the user to provide the missing parameters using the ask_followup_question tool. DO NOT ask for more information on optional parameters if it is not provided.
4. Once you've completed the user's task, you must use the attempt_completion tool to present the result of the task to the user. You may also provide a CLI command to showcase the result of your task; this can be particularly useful for web development tasks, where you can run e.g. \`open index.html\` to show the website you've built.
5. The user may provide feedback, which you can use to make improvements and try again. But DO NOT continue in pointless back and forth conversations, i.e. don't end your responses with questions or offers for further assistance.

====

SYSTEM INFORMATION

Operating System: ${osName()}
Default Shell: ${defaultShell}
Home Directory: ${os.homedir()}
Current Working Directory: ${cwd}
VSCode Visible Files: ${
		vscode.window.visibleTextEditors
			?.map((editor) => editor.document?.uri?.fsPath)
			.filter(Boolean)
			.join(", ") || "(No files open)"
	}
VSCode Opened Tabs: ${
		vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.map((tab) => (tab.input as vscode.TabInputText)?.uri?.fsPath)
			.filter(Boolean)
			.join(", ") || "(No tabs open)"
	}
`

const cwd =
	vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop")

const tools: Tool[] = [
	{
		name: "execute_command",
		description: `Execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands will be executed in the current working directory: ${cwd}`,
		input_schema: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description:
						"The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.",
				},
			},
			required: ["command"],
		},
	},
	{
		name: "list_files_top_level",
		description:
			"List all files and directories at the top level of the specified directory. This should only be used for generic directories you don't necessarily need the nested structure of, like the Desktop.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the directory to list contents for (relative to the current working directory ${cwd})`,
				},
			},
			required: ["path"],
		},
	},
	{
		name: "list_files_recursive",
		description:
			"Recursively list all files and directories within the specified directory. This provides a comprehensive view of the project structure, and can guide decision-making on which files to process or explore further.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the directory to recursively list contents for (relative to the current working directory ${cwd})`,
				},
			},
			required: ["path"],
		},
	},
	{
		name: "view_source_code_definitions_top_level",
		description:
			"Parse all source code files at the top level of the specified directory to extract names of key elements like classes and functions. This tool provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the directory (relative to the current working directory ${cwd}) to parse top level source code files for to view their definitions`,
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
					description: `The path of the file to read (relative to the current working directory ${cwd})`,
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
					description: `The path of the file to write to (relative to the current working directory ${cwd})`,
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
						"The CLI command to execute to show a live demo of the result to the user. For example, use 'open index.html' to display a created website. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.",
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

type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>

export class ClaudeDev {
	private api: ApiHandler
	private maxRequestsPerTask: number
	private requestCount = 0
	apiConversationHistory: Anthropic.MessageParam[] = []
	claudeMessages: ClaudeMessage[] = []
	private askResponse?: ClaudeAskResponse
	private askResponseText?: string
	private askResponseImages?: string[]
	private lastMessageTs?: number
	private providerRef: WeakRef<ClaudeDevProvider>
	abort: boolean = false

	constructor(
		provider: ClaudeDevProvider,
		task: string,
		apiConfiguration: ApiConfiguration,
		maxRequestsPerTask?: number,
		images?: string[]
	) {
		this.providerRef = new WeakRef(provider)
		this.api = buildApiHandler(apiConfiguration)
		this.maxRequestsPerTask = maxRequestsPerTask ?? DEFAULT_MAX_REQUESTS_PER_TASK

		this.startTask(task, images)
	}

	updateApi(apiConfiguration: ApiConfiguration) {
		this.api = buildApiHandler(apiConfiguration)
	}

	updateMaxRequestsPerTask(maxRequestsPerTask: number | undefined) {
		this.maxRequestsPerTask = maxRequestsPerTask ?? DEFAULT_MAX_REQUESTS_PER_TASK
	}

	async handleWebviewAskResponse(askResponse: ClaudeAskResponse, text?: string, images?: string[]) {
		this.askResponse = askResponse
		this.askResponseText = text
		this.askResponseImages = images
	}

	async ask(
		type: ClaudeAsk,
		question: string
	): Promise<{ response: ClaudeAskResponse; text?: string; images?: string[] }> {
		// If this ClaudeDev instance was aborted by the provider, then the only thing keeping us alive is a promise still running in the background, in which case we don't want to send its result to the webview as it is attached to a new instance of ClaudeDev now. So we can safely ignore the result of any active promises, and this class will be deallocated. (Although we set claudeDev = undefined in provider, that simply removes the reference to this instance, but the instance is still alive until this promise resolves or rejects.)
		if (this.abort) {
			throw new Error("ClaudeDev instance aborted")
		}
		this.askResponse = undefined
		this.askResponseText = undefined
		this.askResponseImages = undefined
		const askTs = Date.now()
		this.lastMessageTs = askTs
		this.claudeMessages.push({ ts: askTs, type: "ask", ask: type, text: question })
		await this.providerRef.deref()?.postStateToWebview()
		await pWaitFor(() => this.askResponse !== undefined || this.lastMessageTs !== askTs, { interval: 100 })
		if (this.lastMessageTs !== askTs) {
			throw new Error("Current ask promise was ignored") // could happen if we send multiple asks in a row i.e. with command_output. It's important that when we know an ask could fail, it is handled gracefully
		}
		const result = { response: this.askResponse!, text: this.askResponseText, images: this.askResponseImages }
		this.askResponse = undefined
		this.askResponseText = undefined
		this.askResponseImages = undefined
		return result
	}

	async say(type: ClaudeSay, text?: string, images?: string[]): Promise<undefined> {
		if (this.abort) {
			throw new Error("ClaudeDev instance aborted")
		}
		const sayTs = Date.now()
		this.lastMessageTs = sayTs
		this.claudeMessages.push({ ts: sayTs, type: "say", say: type, text: text, images })
		await this.providerRef.deref()?.postStateToWebview()
	}

	private formatImagesIntoBlocks(images?: string[]): Anthropic.ImageBlockParam[] {
		return images
			? images.map((base64) => ({
					type: "image",
					source: { type: "base64", media_type: "image/webp", data: base64 },
			  }))
			: []
	}

	private formatIntoToolResponse(text?: string, images?: string[]): ToolResponse {
		if (images && images.length > 0) {
			const textBlock: Anthropic.TextBlockParam = { type: "text", text: text ?? "" }
			const imageBlocks: Anthropic.ImageBlockParam[] = this.formatImagesIntoBlocks(images)
			// Placing images after text leads to better results
			return [textBlock, ...imageBlocks]
		} else {
			return text ?? ""
		}
	}

	private async startTask(task: string, images?: string[]): Promise<void> {
		// conversationHistory (for API) and claudeMessages (for webview) need to be in sync
		// if the extension process were killed, then on restart the claudeMessages might not be empty, so we need to set it to [] when we create a new ClaudeDev client (otherwise webview would show stale messages from previous session)
		this.claudeMessages = []
		this.apiConversationHistory = []
		await this.providerRef.deref()?.postStateToWebview()

		// This first message kicks off a task, it is not included in every subsequent message.

		let textBlock: Anthropic.TextBlockParam = { type: "text", text: `Task: \"${task}\"` }
		let imageBlocks: Anthropic.ImageBlockParam[] = this.formatImagesIntoBlocks(images)

		// TODO: create tools that let Claude interact with VSCode (e.g. open a file, list open files, etc.)
		//const openFiles = vscode.window.visibleTextEditors?.map((editor) => editor.document.uri.fsPath).join("\n")

		await this.say("text", task, images)

		let totalInputTokens = 0
		let totalOutputTokens = 0

		while (this.requestCount < this.maxRequestsPerTask) {
			const { didEndLoop, inputTokens, outputTokens } = await this.recursivelyMakeClaudeRequests([
				textBlock,
				...imageBlocks,
			])
			totalInputTokens += inputTokens
			totalOutputTokens += outputTokens

			//  The way this agentic loop works is that claude will be given a task that he then calls tools to complete. unless there's an attempt_completion call, we keep responding back to him with his tool's responses until he either attempt_completion or does not use anymore tools. If he does not use anymore tools, we ask him to consider if he's completed the task and then call attempt_completion, otherwise proceed with completing the task.
			// There is a MAX_REQUESTS_PER_TASK limit to prevent infinite requests, but Claude is prompted to finish the task as efficiently as he can.

			//const totalCost = this.calculateApiCost(totalInputTokens, totalOutputTokens)
			if (didEndLoop) {
				// for now this never happens
				//this.say("task_completed", `Task completed. Total API usage cost: ${totalCost}`)
				break
			} else {
				// this.say(
				// 	"tool",
				// 	"Claude responded with only text blocks but has not called attempt_completion yet. Forcing him to continue with task..."
				// )
				textBlock = {
					type: "text",
					text: "Ask yourself if you have completed the user's task. If you have, use the attempt_completion tool, otherwise proceed to the next step. (This is an automated message, so do not respond to it conversationally. Just proceed with the task.)",
				}
				imageBlocks = []
			}
		}
	}

	async executeTool(toolName: ToolName, toolInput: any, isLastWriteToFile: boolean = false): Promise<ToolResponse> {
		switch (toolName) {
			case "write_to_file":
				return this.writeToFile(toolInput.path, toolInput.content, isLastWriteToFile)
			case "read_file":
				return this.readFile(toolInput.path)
			case "list_files_top_level":
				return this.listFilesTopLevel(toolInput.path)
			case "list_files_recursive":
				return this.listFilesRecursive(toolInput.path)
			case "view_source_code_definitions_top_level":
				return this.viewSourceCodeDefinitionsTopLevel(toolInput.path)
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

	async writeToFile(relPath?: string, newContent?: string, isLast: boolean = true): Promise<ToolResponse> {
		if (relPath === undefined || newContent === undefined) {
			if (newContent === undefined) {
				// Special message for this case since this tends to happen the most
				this.say(
					"error",
					`Claude tried to use write_to_file for '${relPath}' without any content. This tends to happen due to API token limits. Retrying...`
				)
			} else {
				this.say("error", "Claude tried to use write_to_file with missing parameters. Retrying...")
			}
			return "Error: Missing required parameters. Please retry with complete parameters."
		}

		try {
			const absolutePath = path.resolve(cwd, relPath)
			const fileExists = await fs
				.access(absolutePath)
				.then(() => true)
				.catch(() => false)

			let originalContent: string | undefined
			if (fileExists) {
				originalContent = await fs.readFile(absolutePath, "utf-8")
			}

			if (fileExists && originalContent && originalContent.length > 0) {
				// fix issue where claude always removes newline from the file
				if (originalContent.endsWith("\n") && !newContent.endsWith("\n")) {
					newContent += "\n"
				}
				// condensed patch to return to claude
				const diffResult = diff.createPatch(absolutePath, originalContent, newContent)
				// full diff representation for webview
				const diffRepresentation = diff
					.diffLines(originalContent, newContent)
					.map((part) => {
						const prefix = part.added ? "+" : part.removed ? "-" : " "
						return (part.value || "")
							.split("\n")
							.map((line) => (line ? prefix + line : ""))
							.join("\n")
					})
					.join("")

				// Create virtual document with new file, then open diff editor
				const fileName = path.basename(absolutePath)
				vscode.commands.executeCommand(
					"vscode.diff",
					vscode.Uri.file(absolutePath),
					// to create a virtual doc we use a uri scheme registered in extension.ts, which then converts this base64 content into a text document
					// (providing file name with extension in the uri lets vscode know the language of the file and apply syntax highlighting)
					vscode.Uri.parse(`claude-dev-diff:${fileName}`).with({
						query: Buffer.from(newContent).toString("base64"),
					}),
					`${fileName}: Original ↔ Suggested Changes`
				)

				const { response, text, images } = await this.ask(
					"tool",
					JSON.stringify({
						tool: "editedExistingFile",
						path: this.getReadablePath(relPath),
						diff: diffRepresentation,
					} as ClaudeSayTool)
				)
				if (response !== "yesButtonTapped") {
					if (isLast) {
						await this.closeDiffViews()
					}
					if (response === "messageResponse") {
						await this.say("user_feedback", text, images)
						return this.formatIntoToolResponse(
							`The user denied this operation and provided the following feedback:\n\"${text}\"`,
							images
						)
					}
					return "The user denied this operation."
				}
				await fs.writeFile(absolutePath, newContent)
				// Finish by opening the edited file in the editor
				await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
				if (isLast) {
					await this.closeDiffViews()
				}
				return `Changes applied to ${relPath}:\n${diffResult}`
			} else {
				const fileName = path.basename(absolutePath)
				vscode.commands.executeCommand(
					"vscode.diff",
					vscode.Uri.parse(`claude-dev-diff:${fileName}`).with({
						query: Buffer.from("").toString("base64"),
					}),
					vscode.Uri.parse(`claude-dev-diff:${fileName}`).with({
						query: Buffer.from(newContent).toString("base64"),
					}),
					`${fileName}: New File`
				)
				const { response, text, images } = await this.ask(
					"tool",
					JSON.stringify({
						tool: "newFileCreated",
						path: this.getReadablePath(relPath),
						content: newContent,
					} as ClaudeSayTool)
				)
				if (response !== "yesButtonTapped") {
					if (isLast) {
						await this.closeDiffViews()
					}
					if (response === "messageResponse") {
						await this.say("user_feedback", text, images)
						return this.formatIntoToolResponse(
							`The user denied this operation and provided the following feedback:\n\"${text}\"`,
							images
						)
					}
					return "The user denied this operation."
				}
				await fs.mkdir(path.dirname(absolutePath), { recursive: true })
				await fs.writeFile(absolutePath, newContent)
				await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
				if (isLast) {
					await this.closeDiffViews()
				}
				return `New file created and content written to ${relPath}`
			}
		} catch (error) {
			const errorString = `Error writing file: ${JSON.stringify(serializeError(error))}`
			this.say("error", `Error writing file:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`)
			return errorString
		}
	}

	async closeDiffViews() {
		const tabs = vscode.window.tabGroups.all
			.map((tg) => tg.tabs)
			.flat()
			.filter(
				(tab) =>
					tab.input instanceof vscode.TabInputTextDiff && tab.input?.modified?.scheme === "claude-dev-diff"
			)
		for (const tab of tabs) {
			await vscode.window.tabGroups.close(tab)
		}
	}

	async readFile(relPath?: string): Promise<ToolResponse> {
		if (relPath === undefined) {
			this.say("error", "Claude tried to use read_file with missing parameters. Retrying...")
			return "Error: Missing required parameters. Please retry with complete parameters."
		}
		try {
			const absolutePath = path.resolve(cwd, relPath)
			const content = await fs.readFile(absolutePath, "utf-8")
			const { response, text, images } = await this.ask(
				"tool",
				JSON.stringify({ tool: "readFile", path: this.getReadablePath(relPath), content } as ClaudeSayTool)
			)
			if (response !== "yesButtonTapped") {
				if (response === "messageResponse") {
					await this.say("user_feedback", text, images)
					return this.formatIntoToolResponse(
						`The user denied this operation and provided the following feedback:\n\"${text}\"`,
						images
					)
				}
				return "The user denied this operation."
			}
			return content
		} catch (error) {
			const errorString = `Error reading file: ${JSON.stringify(serializeError(error))}`
			this.say("error", `Error reading file:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`)
			return errorString
		}
	}

	async listFilesTopLevel(relDirPath?: string): Promise<ToolResponse> {
		if (relDirPath === undefined) {
			this.say("error", "Claude tried to use list_files_top_level with missing parameters. Retrying...")
			return "Error: Missing required parameters. Please retry with complete parameters."
		}
		try {
			const absolutePath = path.resolve(cwd, relDirPath)
			const files = await listFiles(absolutePath, false)
			const result = this.formatFilesList(absolutePath, files)
			const { response, text, images } = await this.ask(
				"tool",
				JSON.stringify({
					tool: "listFilesTopLevel",
					path: this.getReadablePath(relDirPath),
					content: result,
				} as ClaudeSayTool)
			)
			if (response !== "yesButtonTapped") {
				if (response === "messageResponse") {
					await this.say("user_feedback", text, images)
					return this.formatIntoToolResponse(
						`The user denied this operation and provided the following feedback:\n\"${text}\"`,
						images
					)
				}
				return "The user denied this operation."
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

	async listFilesRecursive(relDirPath?: string): Promise<ToolResponse> {
		if (relDirPath === undefined) {
			this.say("error", "Claude tried to use list_files_recursive with missing parameters. Retrying...")
			return "Error: Missing required parameters. Please retry with complete parameters."
		}
		try {
			const absolutePath = path.resolve(cwd, relDirPath)
			const files = await listFiles(absolutePath, true)
			const result = this.formatFilesList(absolutePath, files)
			const { response, text, images } = await this.ask(
				"tool",
				JSON.stringify({
					tool: "listFilesRecursive",
					path: this.getReadablePath(relDirPath),
					content: result,
				} as ClaudeSayTool)
			)
			if (response !== "yesButtonTapped") {
				if (response === "messageResponse") {
					await this.say("user_feedback", text, images)
					return this.formatIntoToolResponse(
						`The user denied this operation and provided the following feedback:\n\"${text}\"`,
						images
					)
				}
				return "The user denied this operation."
			}
			return result
		} catch (error) {
			const errorString = `Error listing files recursively: ${JSON.stringify(serializeError(error))}`
			this.say(
				"error",
				`Error listing files recursively:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`
			)
			return errorString
		}
	}

	getReadablePath(relPath: string): string {
		// path.resolve is flexible in that it will resolve relative paths like '../../' to the cwd and even ignore the cwd if the relPath is actually an absolute path
		const absolutePath = path.resolve(cwd, relPath)
		if (cwd === path.join(os.homedir(), "Desktop")) {
			// User opened vscode without a workspace, so cwd is the Desktop. Show the full absolute path to keep the user aware of where files are being created
			return absolutePath
		}
		if (path.normalize(absolutePath) === path.normalize(cwd)) {
			return path.basename(absolutePath)
		} else {
			// show the relative path to the cwd
			const normalizedRelPath = path.relative(cwd, absolutePath)
			if (absolutePath.includes(cwd)) {
				return normalizedRelPath
			} else {
				// we are outside the cwd, so show the absolute path (useful for when claude passes in '../../' for example)
				return absolutePath
			}
		}
	}

	formatFilesList(absolutePath: string, files: string[]): string {
		const sorted = files
			.map((file) => {
				// convert absolute path to relative path
				const relativePath = path.relative(absolutePath, file)
				return file.endsWith("/") ? relativePath + "/" : relativePath
			})
			.sort((a, b) => {
				// sort directories before files
				const aIsDir = a.endsWith("/")
				const bIsDir = b.endsWith("/")
				if (aIsDir !== bIsDir) {
					return aIsDir ? -1 : 1
				}
				return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
			})

		if (sorted.length > 1000) {
			const truncatedList = sorted.slice(0, 1000).join("\n")
			const remainingCount = sorted.length - 1000
			return `${truncatedList}\n\n(${remainingCount} files not listed due to automatic truncation. Try listing files in subdirectories if you need to explore further.)`
		} else if (sorted.length === 0 || (sorted.length === 1 && sorted[0] === "")) {
			return "No files found or you do not have permission to view this directory."
		} else {
			return sorted.join("\n")
		}
	}

	async viewSourceCodeDefinitionsTopLevel(relDirPath?: string): Promise<ToolResponse> {
		if (relDirPath === undefined) {
			this.say(
				"error",
				"Claude tried to use view_source_code_definitions_top_level with missing parameters. Retrying..."
			)
			return "Error: Missing required parameters. Please retry with complete parameters."
		}
		try {
			const absolutePath = path.resolve(cwd, relDirPath)
			const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath)
			const { response, text, images } = await this.ask(
				"tool",
				JSON.stringify({
					tool: "viewSourceCodeDefinitionsTopLevel",
					path: this.getReadablePath(relDirPath),
					content: result,
				} as ClaudeSayTool)
			)
			if (response !== "yesButtonTapped") {
				if (response === "messageResponse") {
					await this.say("user_feedback", text, images)
					return this.formatIntoToolResponse(
						`The user denied this operation and provided the following feedback:\n\"${text}\"`,
						images
					)
				}
				return "The user denied this operation."
			}
			return result
		} catch (error) {
			const errorString = `Error parsing source code definitions: ${JSON.stringify(serializeError(error))}`
			this.say(
				"error",
				`Error parsing source code definitions:\n${
					error.message ?? JSON.stringify(serializeError(error), null, 2)
				}`
			)
			return errorString
		}
	}

	async executeCommand(command?: string, returnEmptyStringOnSuccess: boolean = false): Promise<ToolResponse> {
		if (command === undefined) {
			this.say("error", "Claude tried to use execute_command with missing parameters. Retrying...")
			return "Error: Missing required parameters. Please retry with complete parameters."
		}
		const { response, text, images } = await this.ask("command", command)
		if (response !== "yesButtonTapped") {
			if (response === "messageResponse") {
				await this.say("user_feedback", text, images)
				return this.formatIntoToolResponse(
					`The user denied this operation and provided the following feedback:\n\"${text}\"`,
					images
				)
			}
			return "The user denied this operation."
		}

		const sendCommandOutput = async (subprocess: ResultPromise, line: string): Promise<void> => {
			try {
				const { response, text } = await this.ask("command_output", line)
				// if this ask promise is not ignored, that means the user responded to it somehow either by clicking primary button or by typing text
				if (response === "yesButtonTapped") {
					// SIGINT is typically what's sent when a user interrupts a process (like pressing Ctrl+C)
					/*
					.kill sends SIGINT by default. However by not passing any options into .kill(), execa internally sends a SIGKILL after a grace period if the SIGINT failed.
					however it turns out that even this isn't enough for certain processes like npm starting servers. therefore we use the tree-kill package to kill all processes in the process tree, including the root process.
					- Sends signal to all children processes of the process with pid pid, including pid. Signal defaults to SIGTERM.
					*/
					if (subprocess.pid) {
						//subprocess.kill("SIGINT") // will result in for loop throwing error
						treeKill(subprocess.pid, "SIGINT")
					}
				} else {
					// if the user sent some input, we send it to the command stdin
					// add newline as cli programs expect a newline after each input
					// (stdin needs to be set to `pipe` to send input to the command, execa does this by default when using template literals - other options are inherit (from parent process stdin) or null (no stdin))
					subprocess.stdin?.write(text + "\n")
					// Recurse with an empty string to continue listening for more input
					sendCommandOutput(subprocess, "") // empty strings are effectively ignored by the webview, this is done solely to relinquish control over the exit command button
				}
			} catch {
				// This can only happen if this ask promise was ignored, so ignore this error
			}
		}

		try {
			let result = ""
			// execa by default tries to convert bash into javascript, so need to specify `shell: true` to use sh on unix or cmd.exe on windows
			// also worth noting that execa`input` and the execa(command) have nuanced differences like the template literal version handles escaping for you, while with the function call, you need to be more careful about how arguments are passed, especially when using shell: true.
			// execa returns a promise-like object that is both a promise and a Subprocess that has properties like stdin
			const subprocess = execa({ shell: true, cwd: cwd })`${command}`

			subprocess.stdout?.on("data", (data) => {
				if (data) {
					const output = data.toString()
					// stream output to user in realtime
					// do not await since it's sent as an ask and we are not waiting for a response
					sendCommandOutput(subprocess, output)
					result += output
				}
			})

			try {
				await subprocess
				// NOTE: using for await to stream execa output does not return lines that expect user input, so we use listen to the stdout stream and handle data directly, allowing us to process output as soon as it's available even before a full line is complete.
				// for await (const chunk of subprocess) {
				// 	const line = chunk.toString()
				// 	sendCommandOutput(subprocess, line)
				// 	result += `${line}\n`
				// }
			} catch (e) {
				if ((e as ExecaError).signal === "SIGINT") {
					await this.say("command_output", `\nUser exited command...`)
					result += `\n====\nUser terminated command process via SIGINT. This is not an error. Please continue with your task but keep in mind that the command is no longer running. In other words, if this command was used to start a server, the server is no longer running.`
				} else {
					throw e // if the command was not terminated by user, let outer catch handle it as a real error
				}
			}
			// Wait for a short delay to ensure all messages are sent to the webview
			// This delay allows time for non-awaited promises to be created and
			// for their associated messages to be sent to the webview, maintaining
			// the correct order of messages (although the webview is smart about
			// grouping command_output messages despite any gaps anyways)
			await delay(100)
			// for attemptCompletion, we don't want to return the command output
			if (returnEmptyStringOnSuccess) {
				return ""
			}
			return `Command Output:\n${result}`
		} catch (e) {
			const error = e as any
			let errorMessage = error.message || JSON.stringify(serializeError(error), null, 2)
			const errorString = `Error executing command:\n${errorMessage}`
			this.say("error", `Error executing command:\n${errorMessage}`) // TODO: in webview show code block for command errors
			return errorString
		}
	}

	async askFollowupQuestion(question?: string): Promise<ToolResponse> {
		if (question === undefined) {
			this.say("error", "Claude tried to use ask_followup_question with missing parameters. Retrying...")
			return "Error: Missing required parameters. Please retry with complete parameters."
		}
		const { text, images } = await this.ask("followup", question)
		await this.say("user_feedback", text ?? "", images)
		return this.formatIntoToolResponse(`User's response:\n\"${text}\"`, images)
	}

	async attemptCompletion(result?: string, command?: string): Promise<ToolResponse> {
		// result is required, command is optional
		if (result === undefined) {
			this.say("error", "Claude tried to use attempt_completion with missing parameters. Retrying...")
			return "Error: Missing required parameters. Please retry with complete parameters."
		}
		let resultToSend = result
		if (command) {
			await this.say("completion_result", resultToSend)
			// TODO: currently we don't handle if this command fails, it could be useful to let claude know and retry
			const commandResult = await this.executeCommand(command, true)
			// if we received non-empty string, the command was rejected or failed
			if (commandResult) {
				return commandResult
			}
			resultToSend = ""
		}
		const { response, text, images } = await this.ask("completion_result", resultToSend) // this prompts webview to show 'new task' button, and enable text input (which would be the 'text' here)
		if (response === "yesButtonTapped") {
			return "" // signals to recursive loop to stop (for now this never happens since yesButtonTapped will trigger a new task)
		}
		await this.say("user_feedback", text ?? "", images)
		return this.formatIntoToolResponse(
			`The user is not pleased with the results. Use the feedback they provided to successfully complete the task, and then attempt completion again.\nUser's feedback:\n\"${text}\"`,
			images
		)
	}

	async attemptApiRequest(): Promise<Anthropic.Messages.Message> {
		try {
			return await this.api.createMessage(SYSTEM_PROMPT(), this.apiConversationHistory, tools)
		} catch (error) {
			const { response } = await this.ask(
				"api_req_failed",
				error.message ?? JSON.stringify(serializeError(error), null, 2)
			)
			if (response !== "yesButtonTapped") {
				// this will never happen since if noButtonTapped, we will clear current task, aborting this instance
				throw new Error("API request failed")
			}
			await this.say("api_req_retried")
			return this.attemptApiRequest()
		}
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

		this.apiConversationHistory.push({ role: "user", content: userContent })
		if (this.requestCount >= this.maxRequestsPerTask) {
			const { response } = await this.ask(
				"request_limit_reached",
				`Claude Dev has reached the maximum number of requests for this task. Would you like to reset the count and allow him to proceed?`
			)

			if (response === "yesButtonTapped") {
				this.requestCount = 0
			} else {
				this.apiConversationHistory.push({
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Failure: I have reached the request limit for this task. Do you have a new task for me?",
						},
					],
				})
				return { didEndLoop: true, inputTokens: 0, outputTokens: 0 }
			}
		}

		// what the user sees in the webview
		await this.say(
			"api_req_started",
			JSON.stringify({
				request: this.api.createUserReadableRequest(userContent),
			})
		)
		try {
			const response = await this.attemptApiRequest()
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
			const writeToFileCount = response.content.filter(
				(block) => block.type === "tool_use" && (block.name as ToolName) === "write_to_file"
			).length
			let currentWriteToFile = 0
			for (const contentBlock of response.content) {
				if (contentBlock.type === "tool_use") {
					assistantResponses.push(contentBlock)
					const toolName = contentBlock.name as ToolName
					const toolInput = contentBlock.input
					const toolUseId = contentBlock.id
					if (toolName === "attempt_completion") {
						attemptCompletionBlock = contentBlock
					} else {
						if (toolName === "write_to_file") {
							currentWriteToFile++
						}
						// NOTE: while anthropic sdk accepts string or array of string/image, openai sdk (openrouter) only accepts a string
						const result = await this.executeTool(
							toolName,
							toolInput,
							currentWriteToFile === writeToFileCount
						)
						// this.say(
						// 	"tool",
						// 	`\nTool Used: ${toolName}\nTool Input: ${JSON.stringify(toolInput)}\nTool Result: ${result}`
						// )
						toolResults.push({ type: "tool_result", tool_use_id: toolUseId, content: result })
					}
				}
			}

			if (assistantResponses.length > 0) {
				this.apiConversationHistory.push({ role: "assistant", content: assistantResponses })
			} else {
				// this should never happen! it there's no assistant_responses, that means we got no text or tool_use content blocks from API which we should assume is an error
				this.say("error", "Unexpected Error: No assistant messages were found in the API response")
				this.apiConversationHistory.push({
					role: "assistant",
					content: [{ type: "text", text: "Failure: I did not have a response to provide." }],
				})
			}

			let didEndLoop = false

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
					didEndLoop = true
					result = "The user is satisfied with the result."
				}
				toolResults.push({ type: "tool_result", tool_use_id: attemptCompletionBlock.id, content: result })
			}

			if (toolResults.length > 0) {
				if (didEndLoop) {
					this.apiConversationHistory.push({ role: "user", content: toolResults })
					this.apiConversationHistory.push({
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
						didEndLoop: recDidEndLoop,
						inputTokens: recInputTokens,
						outputTokens: recOutputTokens,
					} = await this.recursivelyMakeClaudeRequests(toolResults)
					didEndLoop = recDidEndLoop
					inputTokens += recInputTokens
					outputTokens += recOutputTokens
				}
			}

			return { didEndLoop, inputTokens, outputTokens }
		} catch (error) {
			// this should never happen since the only thing that can throw an error is the attemptApiRequest, which is wrapped in a try catch that sends an ask where if noButtonTapped, will clear current task and destroy this instance. However to avoid unhandled promise rejection, we will end this loop which will end execution of this instance (see startTask)
			return { didEndLoop: true, inputTokens: 0, outputTokens: 0 }
		}
	}
}
