import { Anthropic } from "@anthropic-ai/sdk"
import defaultShell from "default-shell"
import delay from "delay"
import * as diff from "diff"
import fs from "fs/promises"
import os from "os"
import osName from "os-name"
import pWaitFor from "p-wait-for"
import * as path from "path"
import { serializeError } from "serialize-error"
import * as vscode from "vscode"
import { ApiHandler, buildApiHandler } from "./api"
import { TerminalManager } from "./integrations/TerminalManager"
import { LIST_FILES_LIMIT, listFiles, parseSourceCodeForDefinitionsTopLevel } from "./parse-source-code"
import { ClaudeDevProvider } from "./providers/ClaudeDevProvider"
import { ApiConfiguration } from "./shared/api"
import { ClaudeRequestResult } from "./shared/ClaudeRequestResult"
import { combineApiRequests } from "./shared/combineApiRequests"
import { combineCommandSequences } from "./shared/combineCommandSequences"
import { ClaudeAsk, ClaudeMessage, ClaudeSay, ClaudeSayTool } from "./shared/ExtensionMessage"
import { getApiMetrics } from "./shared/getApiMetrics"
import { HistoryItem } from "./shared/HistoryItem"
import { Tool, ToolName } from "./shared/Tool"
import { ClaudeAskResponse } from "./shared/WebviewMessage"
import { findLast, findLastIndex, formatContentBlockToMarkdown } from "./utils"
import { truncateHalfConversation } from "./utils/context-management"
import { extractTextFromFile } from "./utils/extract-text"
import { regexSearchFiles } from "./utils/ripgrep"

const SYSTEM_PROMPT =
	async () => `You are Claude Dev, a highly skilled software developer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.

====
 
CAPABILITIES

- You can read and analyze code in various programming languages, and can write clean, efficient, and well-documented code.
- You can debug complex issues and providing detailed explanations, offering architectural insights and design patterns.
- You have access to tools that let you execute CLI commands on the user's computer, list files in a directory (top level or recursively), extract source code definitions, read and write files, and ask follow-up questions. These tools help you effectively accomplish a wide range of tasks, such as writing code, making edits or improvements to existing files, understanding the current state of a project, performing system operations, and much more.
- When the user initially gives you a task, a recursive list of all filepaths in the current working directory ('${cwd}') will be included in potentially_relevant_details. This provides an overview of the project's file structure, offering key insights into the project from directory/file names (how developers conceptualize and organize their code) and file extensions (the language used). This can also guide decision-making on which files to explore further. If you need to further explore directories such as outside the current working directory, you can use the list_files tool. If you pass 'true' for the recursive parameter, it will list files recursively. Otherwise, it will list files at the top level, which is better suited for generic directories where you don't necessarily need the nested structure, like the Desktop.
- You can use search_files to perform regex searches across files in a specified directory, outputting context-rich results that include surrounding lines. This is particularly useful for understanding code patterns, finding specific implementations, or identifying areas that need refactoring.
- You can use the list_code_definition_names tool to get an overview of source code definitions for all files at the top level of a specified directory. This can be particularly useful when you need to understand the broader context and relationships between certain parts of the code. You may need to call this tool multiple times to understand various parts of the codebase related to the task.
	- For example, when asked to make edits or improvements you might analyze the file structure in the initial potentially_relevant_details to get an overview of the project, then use list_code_definition_names to get further insight using source code definitions for files located in relevant directories, then read_file to examine the contents of relevant files, analyze the code and suggest improvements or make necessary edits, then use the write_to_file tool to implement changes. If you refactored code that could affect other parts of the codebase, you could use search_files to ensure you update other files as needed.
- The execute_command tool lets you run commands on the user's computer and should be used whenever you feel it can help accomplish the user's task. When you need to execute a CLI command, you must provide a clear explanation of what the command does. Prefer to execute complex CLI commands over creating executable scripts, since they are more flexible and easier to run. Interactive and long-running commands are allowed, since the commands are run in the user's VSCode terminal. The user may keep commands running in the background and you will be kept updated on their status along the way. Each command you execute is run in a new terminal instance.

====

RULES

- Your current working directory is: ${cwd}
- You cannot \`cd\` into a different directory to complete a task. You are stuck operating from '${cwd}', so be sure to pass in the correct 'path' parameter when using tools that require a path.
- Do not use the ~ character or $HOME to refer to the home directory.
- Before using the execute_command tool, you must first think about the SYSTEM INFORMATION context provided to understand the user's environment and tailor your commands to ensure they are compatible with their system. You must also consider if the command you need to run should be executed in a specific directory outside of the current working directory '${cwd}', and if so prepend with \`cd\`'ing into that directory && then executing the command (as one command since you are stuck operating from '${cwd}'). For example, if you needed to run \`npm install\` in a project outside of '${cwd}', you would need to prepend with a \`cd\` i.e. pseudocode for this would be \`cd (path to project) && (command, in this case npm install)\`.
- When using the search_files tool, craft your regex patterns carefully to balance specificity and flexibility. Based on the user's task you may use it to find code patterns, TODO comments, function definitions, or any text-based information across the project. The results include context, so analyze the surrounding code to better understand the matches. Leverage the search_files tool in combination with other tools for more comprehensive analysis. For example, use it to find specific code patterns, then use read_file to examine the full context of interesting matches before using write_to_file to make informed changes.
- When creating a new project (such as an app, website, or any software project), organize all new files within a dedicated project directory unless the user specifies otherwise. Use appropriate file paths when writing files, as the write_to_file tool will automatically create any necessary directories. Structure the project logically, adhering to best practices for the specific type of project being created. Unless otherwise specified, new projects should be easily run without additional setup, for example most projects can be built in HTML, CSS, and JavaScript - which you can open in a browser.
- You must try to use multiple tools in one request when possible. For example if you were to create a website, you would use the write_to_file tool to create the necessary files with their appropriate contents all at once. Or if you wanted to analyze a project, you could use the read_file tool multiple times to look at several key files. This will help you accomplish the user's task more efficiently.
- Be sure to consider the type of project (e.g. Python, JavaScript, web application) when determining the appropriate structure and files to include. Also consider what files may be most relevant to accomplishing the task, for example looking at a project's manifest file would help you understand the project's dependencies, which you could incorporate into any code you write.
- When making changes to code, always consider the context in which the code is being used. Ensure that your changes are compatible with the existing codebase and that they follow the project's coding standards and best practices.
- Do not ask for more information than necessary. Use the tools provided to accomplish the user's request efficiently and effectively. When you've completed your task, you must use the attempt_completion tool to present the result to the user. The user may provide feedback, which you can use to make improvements and try again.
- You are only allowed to ask the user questions using the ask_followup_question tool. Use this tool only when you need additional details to complete a task, and be sure to use a clear and concise question that will help you move forward with the task. However if you can use the available tools to avoid having to ask the user questions, you should do so. For example, if the user mentions a file that may be in an outside directory like the Desktop, you should use the list_files tool to list the files in the Desktop and check if the file they are talking about is there, rather than asking the user to provide the file path themselves.
- Your goal is to try to accomplish the user's task, NOT engage in a back and forth conversation.
- NEVER end completion_attempt with a question or request to engage in further conversation! Formulate the end of your result in a way that is final and does not require further input from the user. 
- NEVER start your responses with affirmations like "Certainly", "Okay", "Sure", "Great", etc. You should NOT be conversational in your responses, but rather direct and to the point.
- Feel free to use markdown as much as you'd like in your responses. When using code blocks, always include a language specifier.
- When presented with images, utilize your vision capabilities to thoroughly examine them and extract meaningful information. Incorporate these insights into your thought process as you accomplish the user's task.
- CRITICAL: When editing files with write_to_file, ALWAYS provide the COMPLETE file content in your response. This is NON-NEGOTIABLE. Partial updates or placeholders like '// rest of code unchanged' are STRICTLY FORBIDDEN. You MUST include ALL parts of the file, even if they haven't been modified. Failure to do so will result in incomplete or broken code, severely impacting the user's project.

====

OBJECTIVE

You accomplish a given task iteratively, breaking it down into clear steps and working through them methodically.

1. Analyze the user's task and set clear, achievable goals to accomplish it. Prioritize these goals in a logical order.
2. Work through these goals sequentially, utilizing available tools as necessary. Each goal should correspond to a distinct step in your problem-solving process. It is okay for certain steps to take multiple iterations, i.e. if you need to create many files but are limited by your max output limitations, it's okay to create a few files at a time as each subsequent iteration will keep you informed on the work completed and what's remaining. 
3. Remember, you have extensive capabilities with access to a wide range of tools that can be used in powerful and clever ways as necessary to accomplish each goal. Before calling a tool, do some analysis within <thinking></thinking> tags. First, analyze the file structure provided in potentially_relevant_details to gain context and insights for proceeding effectively. Then, think about which of the provided tools is the most relevant tool to accomplish the user's task. Next, go through each of the required parameters of the relevant tool and determine if the user has directly provided or given enough information to infer a value. When deciding if the parameter can be inferred, carefully consider all the context to see if it supports a specific value. If all of the required parameters are present or can be reasonably inferred, close the thinking tag and proceed with the tool call. BUT, if one of the values for a required parameter is missing, DO NOT invoke the function (not even with fillers for the missing params) and instead, ask the user to provide the missing parameters using the ask_followup_question tool. DO NOT ask for more information on optional parameters if it is not provided.
4. Once you've completed the user's task, you must use the attempt_completion tool to present the result of the task to the user. You may also provide a CLI command to showcase the result of your task; this can be particularly useful for web development tasks, where you can run e.g. \`open index.html\` to show the website you've built.
5. The user may provide feedback, which you can use to make improvements and try again. But DO NOT continue in pointless back and forth conversations, i.e. don't end your responses with questions or offers for further assistance.

====

SYSTEM INFORMATION

Operating System: ${osName()}
Default Shell: ${defaultShell}
Home Directory: ${os.homedir()}
Current Working Directory: ${cwd}
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
		name: "list_files",
		description:
			"List files and directories within the specified directory. If recursive is true, it will list all files and directories recursively. If recursive is false or not provided, it will only list the top-level contents.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the directory to list contents for (relative to the current working directory ${cwd})`,
				},
				recursive: {
					type: "string",
					enum: ["true", "false"],
					description:
						"Whether to list files recursively. Use 'true' for recursive listing, 'false' or omit for top-level only.",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "list_code_definition_names",
		description:
			"Lists definition names (classes, functions, methods, etc.) used in source code files at the top level of the specified directory. This tool provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the directory (relative to the current working directory ${cwd}) to list top level source code definitions for`,
				},
			},
			required: ["path"],
		},
	},
	{
		name: "search_files",
		description:
			"Perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the directory to search in (relative to the current working directory ${cwd}). This directory will be recursively searched.`,
				},
				regex: {
					type: "string",
					description: "The regular expression pattern to search for. Uses Rust regex syntax.",
				},
				filePattern: {
					type: "string",
					description:
						"Optional glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).",
				},
			},
			required: ["path", "regex"],
		},
	},
	{
		name: "read_file",
		description:
			"Read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string.",
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
			"Write content to a file at the specified path. If the file exists, it will be overwritten with the provided content. If the file doesn't exist, it will be created. Always provide the full intended content of the file, without any truncation. This tool will automatically create any directories needed to write the file.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: `The path of the file to write to (relative to the current working directory ${cwd})`,
				},
				content: {
					type: "string",
					description: "The full content to write to the file.",
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
type UserContent = Array<
	Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam
>

export class ClaudeDev {
	readonly taskId: string
	private api: ApiHandler
	private terminalManager: TerminalManager
	private customInstructions?: string
	private alwaysAllowReadOnly: boolean
	apiConversationHistory: Anthropic.MessageParam[] = []
	claudeMessages: ClaudeMessage[] = []
	private askResponse?: ClaudeAskResponse
	private askResponseText?: string
	private askResponseImages?: string[]
	private lastMessageTs?: number
	private consecutiveMistakeCount: number = 0
	private providerRef: WeakRef<ClaudeDevProvider>
	private abort: boolean = false

	constructor(
		provider: ClaudeDevProvider,
		apiConfiguration: ApiConfiguration,
		customInstructions?: string,
		alwaysAllowReadOnly?: boolean,
		task?: string,
		images?: string[],
		historyItem?: HistoryItem
	) {
		this.providerRef = new WeakRef(provider)
		this.api = buildApiHandler(apiConfiguration)
		this.terminalManager = new TerminalManager()
		this.customInstructions = customInstructions
		this.alwaysAllowReadOnly = alwaysAllowReadOnly ?? false

		if (historyItem) {
			this.taskId = historyItem.id
			this.resumeTaskFromHistory()
		} else if (task || images) {
			this.taskId = Date.now().toString()
			this.startTask(task, images)
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}
	}

	updateApi(apiConfiguration: ApiConfiguration) {
		this.api = buildApiHandler(apiConfiguration)
	}

	updateCustomInstructions(customInstructions: string | undefined) {
		this.customInstructions = customInstructions
	}

	updateAlwaysAllowReadOnly(alwaysAllowReadOnly: boolean | undefined) {
		this.alwaysAllowReadOnly = alwaysAllowReadOnly ?? false
	}

	async handleWebviewAskResponse(askResponse: ClaudeAskResponse, text?: string, images?: string[]) {
		this.askResponse = askResponse
		this.askResponseText = text
		this.askResponseImages = images
	}

	// storing task to disk for history

	private async ensureTaskDirectoryExists(): Promise<string> {
		const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}
		const taskDir = path.join(globalStoragePath, "tasks", this.taskId)
		await fs.mkdir(taskDir, { recursive: true })
		return taskDir
	}

	private async getSavedApiConversationHistory(): Promise<Anthropic.MessageParam[]> {
		const filePath = path.join(await this.ensureTaskDirectoryExists(), "api_conversation_history.json")
		const fileExists = await fs
			.access(filePath)
			.then(() => true)
			.catch(() => false)
		if (fileExists) {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		}
		return []
	}

	private async addToApiConversationHistory(message: Anthropic.MessageParam) {
		this.apiConversationHistory.push(message)
		await this.saveApiConversationHistory()
	}

	private async overwriteApiConversationHistory(newHistory: Anthropic.MessageParam[]) {
		this.apiConversationHistory = newHistory
		await this.saveApiConversationHistory()
	}

	private async saveApiConversationHistory() {
		try {
			const filePath = path.join(await this.ensureTaskDirectoryExists(), "api_conversation_history.json")
			await fs.writeFile(filePath, JSON.stringify(this.apiConversationHistory))
		} catch (error) {
			// in the off chance this fails, we don't want to stop the task
			console.error("Failed to save API conversation history:", error)
		}
	}

	private async getSavedClaudeMessages(): Promise<ClaudeMessage[]> {
		const filePath = path.join(await this.ensureTaskDirectoryExists(), "claude_messages.json")
		const fileExists = await fs
			.access(filePath)
			.then(() => true)
			.catch(() => false)
		if (fileExists) {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		}
		return []
	}

	private async addToClaudeMessages(message: ClaudeMessage) {
		this.claudeMessages.push(message)
		await this.saveClaudeMessages()
	}

	private async overwriteClaudeMessages(newMessages: ClaudeMessage[]) {
		this.claudeMessages = newMessages
		await this.saveClaudeMessages()
	}

	private async saveClaudeMessages() {
		try {
			const filePath = path.join(await this.ensureTaskDirectoryExists(), "claude_messages.json")
			await fs.writeFile(filePath, JSON.stringify(this.claudeMessages))
			// combined as they are in ChatView
			const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(this.claudeMessages.slice(1))))
			const taskMessage = this.claudeMessages[0] // first message is always the task say
			const lastRelevantMessage =
				this.claudeMessages[
					findLastIndex(
						this.claudeMessages,
						(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")
					)
				]
			await this.providerRef.deref()?.updateTaskHistory({
				id: this.taskId,
				ts: lastRelevantMessage.ts,
				task: taskMessage.text ?? "",
				tokensIn: apiMetrics.totalTokensIn,
				tokensOut: apiMetrics.totalTokensOut,
				cacheWrites: apiMetrics.totalCacheWrites,
				cacheReads: apiMetrics.totalCacheReads,
				totalCost: apiMetrics.totalCost,
			})
		} catch (error) {
			console.error("Failed to save claude messages:", error)
		}
	}

	async ask(
		type: ClaudeAsk,
		question?: string
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
		await this.addToClaudeMessages({ ts: askTs, type: "ask", ask: type, text: question })
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
		await this.addToClaudeMessages({ ts: sayTs, type: "say", say: type, text: text, images })
		await this.providerRef.deref()?.postStateToWebview()
	}

	private async startTask(task?: string, images?: string[]): Promise<void> {
		// conversationHistory (for API) and claudeMessages (for webview) need to be in sync
		// if the extension process were killed, then on restart the claudeMessages might not be empty, so we need to set it to [] when we create a new ClaudeDev client (otherwise webview would show stale messages from previous session)
		this.claudeMessages = []
		this.apiConversationHistory = []
		await this.providerRef.deref()?.postStateToWebview()

		await this.say("text", task, images)

		let imageBlocks: Anthropic.ImageBlockParam[] = this.formatImagesIntoBlocks(images)
		await this.initiateTaskLoop([
			{
				type: "text",
				text: `<task>\n${task}\n</task>`,
			},
			...imageBlocks,
		])
	}

	private async resumeTaskFromHistory() {
		const modifiedClaudeMessages = await this.getSavedClaudeMessages()

		// Need to modify claude messages for good ux, i.e. if the last message is an api_request_started, then remove it otherwise the user will think the request is still loading
		const lastApiReqStartedIndex = modifiedClaudeMessages.reduce(
			(lastIndex, m, index) => (m.type === "say" && m.say === "api_req_started" ? index : lastIndex),
			-1
		)
		const lastApiReqFinishedIndex = modifiedClaudeMessages.reduce(
			(lastIndex, m, index) => (m.type === "say" && m.say === "api_req_finished" ? index : lastIndex),
			-1
		)
		if (lastApiReqStartedIndex > lastApiReqFinishedIndex && lastApiReqStartedIndex !== -1) {
			modifiedClaudeMessages.splice(lastApiReqStartedIndex, 1)
		}

		// Remove any resume messages that may have been added before
		const lastRelevantMessageIndex = findLastIndex(
			modifiedClaudeMessages,
			(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")
		)
		if (lastRelevantMessageIndex !== -1) {
			modifiedClaudeMessages.splice(lastRelevantMessageIndex + 1)
		}

		await this.overwriteClaudeMessages(modifiedClaudeMessages)
		this.claudeMessages = await this.getSavedClaudeMessages()

		// Now present the claude messages to the user and ask if they want to resume

		const lastClaudeMessage = this.claudeMessages
			.slice()
			.reverse()
			.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")) // could be multiple resume tasks
		// const lastClaudeMessage = this.claudeMessages[lastClaudeMessageIndex]
		// could be a completion result with a command
		// const secondLastClaudeMessage = this.claudeMessages
		// 	.slice()
		// 	.reverse()
		// 	.find(
		// 		(m, index) =>
		// 			index !== lastClaudeMessageIndex && !(m.ask === "resume_task" || m.ask === "resume_completed_task")
		// 	)
		// (lastClaudeMessage?.ask === "command" && secondLastClaudeMessage?.ask === "completion_result")

		let askType: ClaudeAsk
		if (lastClaudeMessage?.ask === "completion_result") {
			askType = "resume_completed_task"
		} else {
			askType = "resume_task"
		}

		const { response, text, images } = await this.ask(askType) // calls poststatetowebview
		let responseText: string | undefined
		let responseImages: string[] | undefined
		if (response === "messageResponse") {
			await this.say("user_feedback", text, images)
			responseText = text
			responseImages = images
		}

		// need to make sure that the api conversation history can be resumed by the api, even if it goes out of sync with claude messages

		// if the last message is an assistant message, we need to check if there's tool use since every tool use has to have a tool response
		// if there's no tool use and only a text block, then we can just add a user message

		// if the last message is a user message, we can need to get the assistant message before it to see if it made tool calls, and if so, fill in the remaining tool responses with 'interrupted'

		const existingApiConversationHistory: Anthropic.Messages.MessageParam[] =
			await this.getSavedApiConversationHistory()

		let modifiedOldUserContent: UserContent // either the last message if its user message, or the user message before the last (assistant) message
		let modifiedApiConversationHistory: Anthropic.Messages.MessageParam[] // need to remove the last user message to replace with new modified user message
		if (existingApiConversationHistory.length > 0) {
			const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]

			if (lastMessage.role === "assistant") {
				const content = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				const hasToolUse = content.some((block) => block.type === "tool_use")

				if (hasToolUse) {
					const toolUseBlocks = content.filter(
						(block) => block.type === "tool_use"
					) as Anthropic.Messages.ToolUseBlock[]
					const toolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => ({
						type: "tool_result",
						tool_use_id: block.id,
						content: "Task was interrupted before this tool call could be completed.",
					}))
					modifiedApiConversationHistory = [...existingApiConversationHistory] // no changes
					modifiedOldUserContent = [...toolResponses]
				} else {
					modifiedApiConversationHistory = [...existingApiConversationHistory]
					modifiedOldUserContent = []
				}
			} else if (lastMessage.role === "user") {
				const previousAssistantMessage: Anthropic.Messages.MessageParam | undefined =
					existingApiConversationHistory[existingApiConversationHistory.length - 2]

				const existingUserContent: UserContent = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				if (previousAssistantMessage && previousAssistantMessage.role === "assistant") {
					const assistantContent = Array.isArray(previousAssistantMessage.content)
						? previousAssistantMessage.content
						: [{ type: "text", text: previousAssistantMessage.content }]

					const toolUseBlocks = assistantContent.filter(
						(block) => block.type === "tool_use"
					) as Anthropic.Messages.ToolUseBlock[]

					if (toolUseBlocks.length > 0) {
						const existingToolResults = existingUserContent.filter(
							(block) => block.type === "tool_result"
						) as Anthropic.ToolResultBlockParam[]

						const missingToolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks
							.filter(
								(toolUse) => !existingToolResults.some((result) => result.tool_use_id === toolUse.id)
							)
							.map((toolUse) => ({
								type: "tool_result",
								tool_use_id: toolUse.id,
								content: "Task was interrupted before this tool call could be completed.",
							}))

						modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1) // removes the last user message
						modifiedOldUserContent = [...existingUserContent, ...missingToolResponses]
					} else {
						modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
						modifiedOldUserContent = [...existingUserContent]
					}
				} else {
					modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
					modifiedOldUserContent = [...existingUserContent]
				}
			} else {
				throw new Error("Unexpected: Last message is not a user or assistant message")
			}
		} else {
			throw new Error("Unexpected: No existing API conversation history")
		}

		let newUserContent: UserContent = [...modifiedOldUserContent]

		const agoText = (() => {
			const timestamp = lastClaudeMessage?.ts ?? Date.now()
			const now = Date.now()
			const diff = now - timestamp
			const minutes = Math.floor(diff / 60000)
			const hours = Math.floor(minutes / 60)
			const days = Math.floor(hours / 24)

			if (days > 0) {
				return `${days} day${days > 1 ? "s" : ""} ago`
			}
			if (hours > 0) {
				return `${hours} hour${hours > 1 ? "s" : ""} ago`
			}
			if (minutes > 0) {
				return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
			}
			return "just now"
		})()

		newUserContent.push({
			type: "text",
			text:
				`Task resumption: This autonomous coding task was interrupted ${agoText}. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '${cwd}'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.` +
				(responseText
					? `\n\nNew instructions for task continuation:\n<user_message>\n${responseText}\n</user_message>`
					: ""),
		})

		if (responseImages && responseImages.length > 0) {
			newUserContent.push(...this.formatImagesIntoBlocks(responseImages))
		}

		await this.overwriteApiConversationHistory(modifiedApiConversationHistory)
		await this.initiateTaskLoop(newUserContent)
	}

	private async initiateTaskLoop(userContent: UserContent): Promise<void> {
		let nextUserContent = userContent
		let includeFileDetails = true
		while (!this.abort) {
			const { didEndLoop } = await this.recursivelyMakeClaudeRequests(nextUserContent, includeFileDetails)
			includeFileDetails = false // we only need file details the first time

			//  The way this agentic loop works is that claude will be given a task that he then calls tools to complete. unless there's an attempt_completion call, we keep responding back to him with his tool's responses until he either attempt_completion or does not use anymore tools. If he does not use anymore tools, we ask him to consider if he's completed the task and then call attempt_completion, otherwise proceed with completing the task.
			// There is a MAX_REQUESTS_PER_TASK limit to prevent infinite requests, but Claude is prompted to finish the task as efficiently as he can.

			//const totalCost = this.calculateApiCost(totalInputTokens, totalOutputTokens)
			if (didEndLoop) {
				// For now a task never 'completes'. This will only happen if the user hits max requests and denies resetting the count.
				//this.say("task_completed", `Task completed. Total API usage cost: ${totalCost}`)
				break
			} else {
				// this.say(
				// 	"tool",
				// 	"Claude responded with only text blocks but has not called attempt_completion yet. Forcing him to continue with task..."
				// )
				nextUserContent = [
					{
						type: "text",
						text: "If you have completed the user's task, use the attempt_completion tool. If you require additional information from the user, use the ask_followup_question tool. Otherwise, if you have not completed the task and do not need additional information, then proceed with the next step of the task. (This is an automated message, so do not respond to it conversationally.)",
					},
				]
				this.consecutiveMistakeCount++
			}
		}
	}

	abortTask() {
		this.abort = true // will stop any autonomously running promises
		this.terminalManager.disposeAll()
	}

	async executeTool(toolName: ToolName, toolInput: any): Promise<ToolResponse> {
		switch (toolName) {
			case "write_to_file":
				return this.writeToFile(toolInput.path, toolInput.content)
			case "read_file":
				return this.readFile(toolInput.path)
			case "list_files":
				return this.listFiles(toolInput.path, toolInput.recursive)
			case "list_code_definition_names":
				return this.listCodeDefinitionNames(toolInput.path)
			case "search_files":
				return this.searchFiles(toolInput.path, toolInput.regex, toolInput.filePattern)
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

	calculateApiCost(
		inputTokens: number,
		outputTokens: number,
		cacheCreationInputTokens?: number,
		cacheReadInputTokens?: number
	): number {
		const modelCacheWritesPrice = this.api.getModel().info.cacheWritesPrice
		let cacheWritesCost = 0
		if (cacheCreationInputTokens && modelCacheWritesPrice) {
			cacheWritesCost = (modelCacheWritesPrice / 1_000_000) * cacheCreationInputTokens
		}
		const modelCacheReadsPrice = this.api.getModel().info.cacheReadsPrice
		let cacheReadsCost = 0
		if (cacheReadInputTokens && modelCacheReadsPrice) {
			cacheReadsCost = (modelCacheReadsPrice / 1_000_000) * cacheReadInputTokens
		}
		const baseInputCost = (this.api.getModel().info.inputPrice / 1_000_000) * inputTokens
		const outputCost = (this.api.getModel().info.outputPrice / 1_000_000) * outputTokens
		const totalCost = cacheWritesCost + cacheReadsCost + baseInputCost + outputCost
		return totalCost
	}

	async writeToFile(relPath?: string, newContent?: string): Promise<ToolResponse> {
		if (relPath === undefined) {
			this.consecutiveMistakeCount++
			return await this.sayAndCreateMissingParamError("write_to_file", "path")
		}
		if (newContent === undefined) {
			this.consecutiveMistakeCount++
			// Custom error message for this particular case
			await this.say(
				"error",
				`Claude tried to use write_to_file for '${relPath}' without value for required parameter 'content'. This is likely due to reaching the maximum output token limit. Retrying with suggestion to change response size...`
			)
			return await this.formatToolError(
				`Missing value for required parameter 'content'. This may occur if the file is too large, exceeding output limits. Consider splitting into smaller files or reducing content size. Please retry with all required parameters.`
			)
		}
		this.consecutiveMistakeCount = 0
		try {
			const absolutePath = path.resolve(cwd, relPath)
			const fileExists = await fs
				.access(absolutePath)
				.then(() => true)
				.catch(() => false)

			// if the file is already open, ensure it's not dirty before getting its contents
			if (fileExists) {
				const existingDocument = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === absolutePath)
				if (existingDocument && existingDocument.isDirty) {
					await existingDocument.save()
				}
			}

			let originalContent: string
			if (fileExists) {
				originalContent = await fs.readFile(absolutePath, "utf-8")
				// fix issue where claude always removes newline from the file
				const eol = originalContent.includes("\r\n") ? "\r\n" : "\n"
				if (originalContent.endsWith(eol) && !newContent.endsWith(eol)) {
					newContent += eol
				}
			} else {
				originalContent = ""
			}

			const fileName = path.basename(absolutePath)

			// for new files, create any necessary directories and keep track of new directories to delete if the user denies the operation

			// Keep track of newly created directories
			const createdDirs: string[] = await this.createDirectoriesForFile(absolutePath)
			console.log(`Created directories: ${createdDirs.join(", ")}`)
			// make sure the file exists before we open it
			if (!fileExists) {
				await fs.writeFile(absolutePath, "")
			}

			// Open the existing file with the new contents
			const updatedDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath))

			// await updatedDocument.save()
			// const edit = new vscode.WorkspaceEdit()
			// const fullRange = new vscode.Range(
			// 	updatedDocument.positionAt(0),
			// 	updatedDocument.positionAt(updatedDocument.getText().length)
			// )
			// edit.replace(updatedDocument.uri, fullRange, newContent)
			// await vscode.workspace.applyEdit(edit)

			// Windows file locking issues can prevent temporary files from being saved or closed properly.
			// To avoid these problems, we use in-memory TextDocument objects with the `untitled` scheme.
			// This method keeps the document entirely in memory, bypassing the filesystem and ensuring
			// a consistent editing experience across all platforms. This also has the added benefit of not
			// polluting the user's workspace with temporary files.

			// Create an in-memory document for the new content
			// const inMemoryDocumentUri = vscode.Uri.parse(`untitled:${fileName}`) // untitled scheme is necessary to open a file without it being saved to disk
			// const inMemoryDocument = await vscode.workspace.openTextDocument(inMemoryDocumentUri)
			// const edit = new vscode.WorkspaceEdit()
			// edit.insert(inMemoryDocumentUri, new vscode.Position(0, 0), newContent)
			// await vscode.workspace.applyEdit(edit)

			// Show diff
			await vscode.commands.executeCommand(
				"vscode.diff",
				vscode.Uri.parse(`claude-dev-diff:${fileName}`).with({
					query: Buffer.from(originalContent).toString("base64"),
				}),
				updatedDocument.uri,
				`${fileName}: ${fileExists ? "Original ↔ Claude's Changes" : "New File"} (Editable)`
			)

			// if the file was already open, close it (must happen after showing the diff view since if it's the only tab the column will close)
			let documentWasOpen = false

			// close the tab if it's open
			const tabs = vscode.window.tabGroups.all
				.map((tg) => tg.tabs)
				.flat()
				.filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === absolutePath)
			for (const tab of tabs) {
				await vscode.window.tabGroups.close(tab)
				console.log(`Closed tab for ${absolutePath}`)
				documentWasOpen = true
			}

			console.log(`Document was open: ${documentWasOpen}`)

			// edit needs to happen after we close the original tab
			const edit = new vscode.WorkspaceEdit()
			if (!fileExists) {
				edit.insert(updatedDocument.uri, new vscode.Position(0, 0), newContent)
			} else {
				const fullRange = new vscode.Range(
					updatedDocument.positionAt(0),
					updatedDocument.positionAt(updatedDocument.getText().length)
				)
				edit.replace(updatedDocument.uri, fullRange, newContent)
			}
			// Apply the edit, but without saving so this doesnt trigger a local save in timeline history
			await vscode.workspace.applyEdit(edit) // has the added benefit of maintaing the file's original EOLs

			// Find the first range where the content differs and scroll to it
			if (fileExists) {
				const diffResult = diff.diffLines(originalContent, newContent)
				for (let i = 0, lineCount = 0; i < diffResult.length; i++) {
					const part = diffResult[i]
					if (part.added || part.removed) {
						const startLine = lineCount + 1
						const endLine = lineCount + (part.count || 0)
						const activeEditor = vscode.window.activeTextEditor
						if (activeEditor) {
							try {
								activeEditor.revealRange(
									// + 3 to move the editor up slightly as this looks better
									new vscode.Range(
										new vscode.Position(startLine, 0),
										new vscode.Position(
											Math.min(endLine + 3, activeEditor.document.lineCount - 1),
											0
										)
									),
									vscode.TextEditorRevealType.InCenter
								)
							} catch (error) {
								console.error(`Error revealing range for ${absolutePath}: ${error}`)
							}
						}
						break
					}
					lineCount += part.count || 0
				}
			}

			// remove cursor from the document
			await vscode.commands.executeCommand("workbench.action.focusSideBar")

			let userResponse: {
				response: ClaudeAskResponse
				text?: string
				images?: string[]
			}
			if (fileExists) {
				userResponse = await this.ask(
					"tool",
					JSON.stringify({
						tool: "editedExistingFile",
						path: this.getReadablePath(relPath),
						diff: this.createPrettyPatch(relPath, originalContent, newContent),
					} as ClaudeSayTool)
				)
			} else {
				userResponse = await this.ask(
					"tool",
					JSON.stringify({
						tool: "newFileCreated",
						path: this.getReadablePath(relPath),
						content: newContent,
					} as ClaudeSayTool)
				)
			}
			const { response, text, images } = userResponse

			// const closeInMemoryDocAndDiffViews = async () => {
			// 	// ensure that the in-memory doc is active editor (this seems to fail on windows machines if its already active, so ignoring if there's an error as it's likely it's already active anyways)
			// 	// try {
			// 	// 	await vscode.window.showTextDocument(inMemoryDocument, {
			// 	// 		preview: false, // ensures it opens in non-preview tab (preview tabs are easily replaced)
			// 	// 		preserveFocus: false,
			// 	// 	})
			// 	// 	// await vscode.window.showTextDocument(inMemoryDocument.uri, { preview: true, preserveFocus: false })
			// 	// } catch (error) {
			// 	// 	console.log(`Could not open editor for ${absolutePath}: ${error}`)
			// 	// }
			// 	// await delay(50)
			// 	// // Wait for the in-memory document to become the active editor (sometimes vscode timing issues happen and this would accidentally close claude dev!)
			// 	// await pWaitFor(
			// 	// 	() => {
			// 	// 		return vscode.window.activeTextEditor?.document === inMemoryDocument
			// 	// 	},
			// 	// 	{ timeout: 5000, interval: 50 }
			// 	// )

			// 	// if (vscode.window.activeTextEditor?.document === inMemoryDocument) {
			// 	// 	await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor") // allows us to close the untitled doc without being prompted to save it
			// 	// }

			// 	await this.closeDiffViews()
			// }

			if (response !== "yesButtonTapped") {
				if (!fileExists) {
					if (updatedDocument.isDirty) {
						await updatedDocument.save()
					}
					await this.closeDiffViews()
					await fs.unlink(absolutePath)
					// Remove only the directories we created, in reverse order
					for (let i = createdDirs.length - 1; i >= 0; i--) {
						await fs.rmdir(createdDirs[i])
						console.log(`Directory ${createdDirs[i]} has been deleted.`)
					}
					console.log(`File ${absolutePath} has been deleted.`)
				} else {
					// revert document
					const edit = new vscode.WorkspaceEdit()
					const fullRange = new vscode.Range(
						updatedDocument.positionAt(0),
						updatedDocument.positionAt(updatedDocument.getText().length)
					)
					edit.replace(updatedDocument.uri, fullRange, originalContent)
					// Apply the edit and save, since contents shouldnt have changed this wont show in local history unless of course the user made changes and saved during the edit
					await vscode.workspace.applyEdit(edit)
					await updatedDocument.save()
					console.log(`File ${absolutePath} has been reverted to its original content.`)
					if (documentWasOpen) {
						await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
					}
					await this.closeDiffViews()
				}

				if (response === "messageResponse") {
					await this.say("user_feedback", text, images)
					return this.formatToolResponseWithImages(await this.formatToolDeniedFeedback(text), images)
				}
				return await this.formatToolDenied()
			}

			const editedContent = updatedDocument.getText()
			if (updatedDocument.isDirty) {
				await updatedDocument.save()
			}

			// Read the potentially edited content from the document

			// trigger an entry in the local history for the file
			// if (fileExists) {
			// 	await fs.writeFile(absolutePath, originalContent)
			// 	const editor = await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
			// 	const edit = new vscode.WorkspaceEdit()
			// 	const fullRange = new vscode.Range(
			// 		editor.document.positionAt(0),
			// 		editor.document.positionAt(editor.document.getText().length)
			// 	)
			// 	edit.replace(editor.document.uri, fullRange, editedContent)
			// 	// Apply the edit, this will trigger a local save and timeline history
			// 	await vscode.workspace.applyEdit(edit) // has the added benefit of maintaing the file's original EOLs
			// 	await editor.document.save()
			// }

			// if (!fileExists) {
			// 	await fs.mkdir(path.dirname(absolutePath), { recursive: true })
			// 	await fs.writeFile(absolutePath, "")
			// }
			// await closeInMemoryDocAndDiffViews()

			// await fs.writeFile(absolutePath, editedContent)

			// open file and add text to it, if it fails fallback to using writeFile
			// we try doing it this way since it adds to local history for users to see what's changed in the file's timeline
			// try {
			// 	const editor = await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
			// 	const edit = new vscode.WorkspaceEdit()
			// 	const fullRange = new vscode.Range(
			// 		editor.document.positionAt(0),
			// 		editor.document.positionAt(editor.document.getText().length)
			// 	)
			// 	edit.replace(editor.document.uri, fullRange, editedContent)
			// 	// Apply the edit, this will trigger a local save and timeline history
			// 	await vscode.workspace.applyEdit(edit) // has the added benefit of maintaing the file's original EOLs
			// 	await editor.document.save()
			// } catch (saveError) {
			// 	console.log(`Could not open editor for ${absolutePath}: ${saveError}`)
			// 	await fs.writeFile(absolutePath, editedContent)
			// 	// calling showTextDocument would sometimes fail even though changes were applied, so we'll ignore these one-off errors (likely due to vscode locking issues)
			// 	try {
			// 		await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
			// 	} catch (openFileError) {
			// 		console.log(`Could not open editor for ${absolutePath}: ${openFileError}`)
			// 	}
			// }

			await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })

			await this.closeDiffViews()

			// await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })

			// If the edited content has different EOL characters, we don't want to show a diff with all the EOL differences.
			const newContentEOL = newContent.includes("\r\n") ? "\r\n" : "\n"
			const normalizedEditedContent = editedContent.replace(/\r\n|\n/g, newContentEOL)
			const normalizedNewContent = newContent.replace(/\r\n|\n/g, newContentEOL) // just in case the new content has a mix of varying EOL characters
			if (normalizedEditedContent !== normalizedNewContent) {
				const userDiff = diff.createPatch(relPath, normalizedNewContent, normalizedEditedContent)
				await this.say(
					"user_feedback_diff",
					JSON.stringify({
						tool: fileExists ? "editedExistingFile" : "newFileCreated",
						path: this.getReadablePath(relPath),
						diff: this.createPrettyPatch(relPath, normalizedNewContent, normalizedEditedContent),
					} as ClaudeSayTool)
				)
				return this.formatToolResult(
					`The user made the following updates to your content:\n\n${userDiff}\n\nThe updated content, which includes both your original modifications and the user's additional edits, has been successfully saved to ${relPath}. Note this does not mean you need to re-write the file with the user's changes, they have already been applied to the file.`
				)
			} else {
				return this.formatToolResult(`The content was successfully saved to ${relPath}.`)
			}
		} catch (error) {
			const errorString = `Error writing file: ${JSON.stringify(serializeError(error))}`
			await this.say(
				"error",
				`Error writing file:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`
			)
			return await this.formatToolError(errorString)
		}
	}

	/**
	 * Asynchronously creates all non-existing subdirectories for a given file path
	 * and collects them in an array for later deletion.
	 *
	 * @param filePath - The full path to a file.
	 * @returns A promise that resolves to an array of newly created directories.
	 */
	async createDirectoriesForFile(filePath: string): Promise<string[]> {
		const newDirectories: string[] = []
		const normalizedFilePath = path.normalize(filePath) // Normalize path for cross-platform compatibility
		const directoryPath = path.dirname(normalizedFilePath)

		let currentPath = directoryPath
		const dirsToCreate: string[] = []

		// Traverse up the directory tree and collect missing directories
		while (!(await this.exists(currentPath))) {
			dirsToCreate.push(currentPath)
			currentPath = path.dirname(currentPath)
		}

		// Create directories from the topmost missing one down to the target directory
		for (let i = dirsToCreate.length - 1; i >= 0; i--) {
			await fs.mkdir(dirsToCreate[i])
			newDirectories.push(dirsToCreate[i])
		}

		return newDirectories
	}

	/**
	 * Helper function to check if a path exists.
	 *
	 * @param path - The path to check.
	 * @returns A promise that resolves to true if the path exists, false otherwise.
	 */
	async exists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath)
			return true
		} catch {
			return false
		}
	}

	createPrettyPatch(filename = "file", oldStr: string, newStr: string) {
		const patch = diff.createPatch(filename, oldStr, newStr)
		const lines = patch.split("\n")
		const prettyPatchLines = lines.slice(4)
		return prettyPatchLines.join("\n")
	}

	async closeDiffViews() {
		const tabs = vscode.window.tabGroups.all
			.map((tg) => tg.tabs)
			.flat()
			.filter(
				(tab) =>
					tab.input instanceof vscode.TabInputTextDiff && tab.input?.original?.scheme === "claude-dev-diff"
			)

		for (const tab of tabs) {
			// trying to close dirty views results in save popup
			if (!tab.isDirty) {
				await vscode.window.tabGroups.close(tab)
			}
		}
	}

	async readFile(relPath?: string): Promise<ToolResponse> {
		if (relPath === undefined) {
			this.consecutiveMistakeCount++
			return await this.sayAndCreateMissingParamError("read_file", "path")
		}
		this.consecutiveMistakeCount = 0
		try {
			const absolutePath = path.resolve(cwd, relPath)
			const content = await extractTextFromFile(absolutePath)

			const message = JSON.stringify({
				tool: "readFile",
				path: this.getReadablePath(relPath),
				content: absolutePath,
			} as ClaudeSayTool)
			if (this.alwaysAllowReadOnly) {
				await this.say("tool", message)
			} else {
				const { response, text, images } = await this.ask("tool", message)
				if (response !== "yesButtonTapped") {
					if (response === "messageResponse") {
						await this.say("user_feedback", text, images)
						return this.formatToolResponseWithImages(await this.formatToolDeniedFeedback(text), images)
					}
					return await this.formatToolDenied()
				}
			}

			return content
		} catch (error) {
			const errorString = `Error reading file: ${JSON.stringify(serializeError(error))}`
			await this.say(
				"error",
				`Error reading file:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`
			)
			return await this.formatToolError(errorString)
		}
	}

	async listFiles(relDirPath?: string, recursiveRaw?: string): Promise<ToolResponse> {
		if (relDirPath === undefined) {
			this.consecutiveMistakeCount++
			return await this.sayAndCreateMissingParamError("list_files", "path")
		}
		this.consecutiveMistakeCount = 0
		try {
			const recursive = recursiveRaw?.toLowerCase() === "true"
			const absolutePath = path.resolve(cwd, relDirPath)
			const files = await listFiles(absolutePath, recursive)
			const result = this.formatFilesList(absolutePath, files)

			const message = JSON.stringify({
				tool: recursive ? "listFilesRecursive" : "listFilesTopLevel",
				path: this.getReadablePath(relDirPath),
				content: result,
			} as ClaudeSayTool)
			if (this.alwaysAllowReadOnly) {
				await this.say("tool", message)
			} else {
				const { response, text, images } = await this.ask("tool", message)
				if (response !== "yesButtonTapped") {
					if (response === "messageResponse") {
						await this.say("user_feedback", text, images)
						return this.formatToolResponseWithImages(await this.formatToolDeniedFeedback(text), images)
					}
					return await this.formatToolDenied()
				}
			}

			return this.formatToolResult(result)
		} catch (error) {
			const errorString = `Error listing files and directories: ${JSON.stringify(serializeError(error))}`
			await this.say(
				"error",
				`Error listing files and directories:\n${
					error.message ?? JSON.stringify(serializeError(error), null, 2)
				}`
			)
			return await this.formatToolError(errorString)
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
			// Sort so files are listed under their respective directories to make it clear what files are children of what directories. Since we build file list top down, even if file list is truncated it will show directories that claude can then explore further.
			.sort((a, b) => {
				const aParts = a.split("/")
				const bParts = b.split("/")
				for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
					if (aParts[i] !== bParts[i]) {
						// If one is a directory and the other isn't at this level, sort the directory first
						if (i + 1 === aParts.length && i + 1 < bParts.length) {
							return -1
						}
						if (i + 1 === bParts.length && i + 1 < aParts.length) {
							return 1
						}
						// Otherwise, sort alphabetically
						return aParts[i].localeCompare(bParts[i], undefined, { numeric: true, sensitivity: "base" })
					}
				}
				// If all parts are the same up to the length of the shorter path,
				// the shorter one comes first
				return aParts.length - bParts.length
			})
		if (sorted.length >= LIST_FILES_LIMIT) {
			const truncatedList = sorted.slice(0, LIST_FILES_LIMIT).join("\n")
			return `${truncatedList}\n\n(Truncated at ${LIST_FILES_LIMIT} results. Try listing files in subdirectories if you need to explore further.)`
		} else if (sorted.length === 0 || (sorted.length === 1 && sorted[0] === "")) {
			return "No files found or you do not have permission to view this directory."
		} else {
			return sorted.join("\n")
		}
	}

	async listCodeDefinitionNames(relDirPath?: string): Promise<ToolResponse> {
		if (relDirPath === undefined) {
			this.consecutiveMistakeCount++
			return await this.sayAndCreateMissingParamError("list_code_definition_names", "path")
		}
		this.consecutiveMistakeCount = 0
		try {
			const absolutePath = path.resolve(cwd, relDirPath)
			const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath)

			const message = JSON.stringify({
				tool: "listCodeDefinitionNames",
				path: this.getReadablePath(relDirPath),
				content: result,
			} as ClaudeSayTool)
			if (this.alwaysAllowReadOnly) {
				await this.say("tool", message)
			} else {
				const { response, text, images } = await this.ask("tool", message)
				if (response !== "yesButtonTapped") {
					if (response === "messageResponse") {
						await this.say("user_feedback", text, images)
						return this.formatToolResponseWithImages(await this.formatToolDeniedFeedback(text), images)
					}
					return await this.formatToolDenied()
				}
			}

			return this.formatToolResult(result)
		} catch (error) {
			const errorString = `Error parsing source code definitions: ${JSON.stringify(serializeError(error))}`
			await this.say(
				"error",
				`Error parsing source code definitions:\n${
					error.message ?? JSON.stringify(serializeError(error), null, 2)
				}`
			)
			return await this.formatToolError(errorString)
		}
	}

	async searchFiles(relDirPath: string, regex: string, filePattern?: string): Promise<ToolResponse> {
		if (relDirPath === undefined) {
			this.consecutiveMistakeCount++
			return await this.sayAndCreateMissingParamError("search_files", "path")
		}
		if (regex === undefined) {
			this.consecutiveMistakeCount++
			return await this.sayAndCreateMissingParamError("search_files", "regex", relDirPath)
		}
		this.consecutiveMistakeCount = 0
		try {
			const absolutePath = path.resolve(cwd, relDirPath)
			const results = await regexSearchFiles(cwd, absolutePath, regex, filePattern)

			const message = JSON.stringify({
				tool: "searchFiles",
				path: this.getReadablePath(relDirPath),
				regex: regex,
				filePattern: filePattern,
				content: results,
			} as ClaudeSayTool)

			if (this.alwaysAllowReadOnly) {
				await this.say("tool", message)
			} else {
				const { response, text, images } = await this.ask("tool", message)
				if (response !== "yesButtonTapped") {
					if (response === "messageResponse") {
						await this.say("user_feedback", text, images)
						return this.formatToolResponseWithImages(await this.formatToolDeniedFeedback(text), images)
					}
					return await this.formatToolDenied()
				}
			}

			return this.formatToolResult(results)
		} catch (error) {
			const errorString = `Error searching files: ${JSON.stringify(serializeError(error))}`
			await this.say(
				"error",
				`Error searching files:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`
			)
			return await this.formatToolError(errorString)
		}
	}

	async executeCommand(command?: string, returnEmptyStringOnSuccess: boolean = false): Promise<ToolResponse> {
		if (command === undefined) {
			this.consecutiveMistakeCount++
			return await this.sayAndCreateMissingParamError("execute_command", "command")
		}
		this.consecutiveMistakeCount = 0
		const { response, text, images } = await this.ask("command", command)
		if (response !== "yesButtonTapped") {
			if (response === "messageResponse") {
				await this.say("user_feedback", text, images)
				return this.formatToolResponseWithImages(await this.formatToolDeniedFeedback(text), images)
			}
			return await this.formatToolDenied()
		}

		try {
			const terminalInfo = await this.terminalManager.getOrCreateTerminal(cwd)
			terminalInfo.terminal.show() // weird visual bug when creating new terminals (even manually) where there's an empty space at the top.
			const process = this.terminalManager.runCommand(terminalInfo, command)

			let userFeedback: { text?: string; images?: string[] } | undefined
			let didContinue = false
			const sendCommandOutput = async (line: string): Promise<void> => {
				try {
					const { response, text, images } = await this.ask("command_output", line)
					if (response === "yesButtonTapped") {
						// proceed while running
					} else {
						userFeedback = { text, images }
					}
					didContinue = true
					process.continue() // continue past the await
				} catch {
					// This can only happen if this ask promise was ignored, so ignore this error
				}
			}

			let result = ""
			process.on("line", (line) => {
				result += line + "\n"
				if (!didContinue) {
					sendCommandOutput(line)
				} else {
					this.say("command_output", line)
				}
			})

			let completed = false
			process.once("completed", () => {
				completed = true
			})

			process.once("no_shell_integration", async () => {
				await this.say("shell_integration_warning")
			})

			await process

			// Wait for a short delay to ensure all messages are sent to the webview
			// This delay allows time for non-awaited promises to be created and
			// for their associated messages to be sent to the webview, maintaining
			// the correct order of messages (although the webview is smart about
			// grouping command_output messages despite any gaps anyways)
			await delay(50)

			result = result.trim()

			if (userFeedback) {
				await this.say("user_feedback", userFeedback.text, userFeedback.images)
				return this.formatToolResponseWithImages(
					`Command is still running in the user's terminal.${
						result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
					}\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
					userFeedback.images
				)
			}

			// for attemptCompletion, we don't want to return the command output
			if (returnEmptyStringOnSuccess) {
				return ""
			}
			if (completed) {
				return await this.formatToolResult(
					`Command executed.${result.length > 0 ? `\nOutput:\n${result}` : ""}`
				)
			} else {
				return await this.formatToolResult(
					`Command is still running in the user's terminal.${
						result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
					}\n\nYou will be updated on the terminal status and new output in the future.`
				)
			}
		} catch (error) {
			let errorMessage = error.message || JSON.stringify(serializeError(error), null, 2)
			const errorString = `Error executing command:\n${errorMessage}`
			await this.say("error", `Error executing command:\n${errorMessage}`)
			return await this.formatToolError(errorString)
		}
	}

	async askFollowupQuestion(question?: string): Promise<ToolResponse> {
		if (question === undefined) {
			this.consecutiveMistakeCount++
			return await this.sayAndCreateMissingParamError("ask_followup_question", "question")
		}
		this.consecutiveMistakeCount = 0
		const { text, images } = await this.ask("followup", question)
		await this.say("user_feedback", text ?? "", images)
		return this.formatToolResponseWithImages(`<answer>\n${text}\n</answer>`, images)
	}

	async attemptCompletion(result?: string, command?: string): Promise<ToolResponse> {
		// result is required, command is optional
		if (result === undefined) {
			this.consecutiveMistakeCount++
			return await this.sayAndCreateMissingParamError("attempt_completion", "result")
		}
		this.consecutiveMistakeCount = 0
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
		return this.formatToolResponseWithImages(
			`The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.\n<feedback>\n${text}\n</feedback>`,
			images
		)
	}

	async attemptApiRequest(): Promise<Anthropic.Messages.Message> {
		try {
			let systemPrompt = await SYSTEM_PROMPT()
			if (this.customInstructions && this.customInstructions.trim()) {
				// altering the system prompt mid-task will break the prompt cache, but in the grand scheme this will not change often so it's better to not pollute user messages with it the way we have to with <potentially relevant details>
				systemPrompt += `
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user. They should be followed and given precedence in case of conflicts with previous instructions.

${this.customInstructions.trim()}
`
			}

			// If the last API request's total token usage is close to the context window, truncate the conversation history to free up space for the new request
			const lastApiReqFinished = findLast(this.claudeMessages, (m) => m.say === "api_req_finished")
			if (lastApiReqFinished && lastApiReqFinished.text) {
				const {
					tokensIn,
					tokensOut,
					cacheWrites,
					cacheReads,
				}: { tokensIn?: number; tokensOut?: number; cacheWrites?: number; cacheReads?: number } = JSON.parse(
					lastApiReqFinished.text
				)
				const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
				const contextWindow = this.api.getModel().info.contextWindow
				const maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8)
				if (totalTokens >= maxAllowedSize) {
					const truncatedMessages = truncateHalfConversation(this.apiConversationHistory)
					await this.overwriteApiConversationHistory(truncatedMessages)
				}
			}
			const { message, userCredits } = await this.api.createMessage(
				systemPrompt,
				this.apiConversationHistory,
				tools
			)
			if (userCredits !== undefined) {
				console.log("Updating credits", userCredits)
				// TODO: update credits
			}
			return message
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
		userContent: UserContent,
		includeFileDetails: boolean = false
	): Promise<ClaudeRequestResult> {
		if (this.abort) {
			throw new Error("ClaudeDev instance aborted")
		}

		if (this.consecutiveMistakeCount >= 3) {
			const { response, text, images } = await this.ask(
				"mistake_limit_reached",
				this.api.getModel().id.includes("claude")
					? `This may indicate a failure in his thought process or inability to use a tool properly, which can be mitigated with some user guidance (e.g. "Try breaking down the task into smaller steps").`
					: "Claude Dev uses complex prompts and iterative task execution that may be challenging for less capable models. For best results, it's recommended to use Claude 3.5 Sonnet for its advanced agentic coding capabilities."
			)
			if (response === "messageResponse") {
				userContent.push(
					...[
						{
							type: "text",
							text: `You seem to be having trouble proceeding. The user has provided the following feedback to help guide you:\n<feedback>\n${text}\n</feedback>`,
						} as Anthropic.Messages.TextBlockParam,
						...this.formatImagesIntoBlocks(images),
					]
				)
			}
			this.consecutiveMistakeCount = 0
		}

		// getting verbose details is an expensive operation, it uses globby to top-down build file structure of project which for large projects can take a few seconds
		// for the best UX we show a placeholder api_req_started message with a loading spinner as this happens
		await this.say(
			"api_req_started",
			JSON.stringify({
				request:
					userContent.map(formatContentBlockToMarkdown).join("\n\n") +
					"\n\n<potentially_relevant_details>\nLoading...\n</potentially_relevant_details>",
			})
		)

		// potentially expensive operation
		const potentiallyRelevantDetails = await this.getPotentiallyRelevantDetails(includeFileDetails)

		// add potentially relevant details as its own text block, separate from tool results
		userContent.push({ type: "text", text: potentiallyRelevantDetails })

		await this.addToApiConversationHistory({ role: "user", content: userContent })

		// since we sent off a placeholder api_req_started message to update the webview while waiting to actually start the API request (to load potential details for example), we need to update the text of that message
		const lastApiReqIndex = findLastIndex(this.claudeMessages, (m) => m.say === "api_req_started")
		this.claudeMessages[lastApiReqIndex].text = JSON.stringify({
			request: userContent.map(formatContentBlockToMarkdown).join("\n\n"),
		})
		await this.saveClaudeMessages()
		await this.providerRef.deref()?.postStateToWebview()

		try {
			const response = await this.attemptApiRequest()

			if (this.abort) {
				throw new Error("ClaudeDev instance aborted")
			}

			let assistantResponses: Anthropic.Messages.ContentBlock[] = []
			let inputTokens = response.usage.input_tokens
			let outputTokens = response.usage.output_tokens
			let cacheCreationInputTokens =
				(response as Anthropic.Beta.PromptCaching.Messages.PromptCachingBetaMessage).usage
					.cache_creation_input_tokens || undefined
			let cacheReadInputTokens =
				(response as Anthropic.Beta.PromptCaching.Messages.PromptCachingBetaMessage).usage
					.cache_read_input_tokens || undefined
			await this.say(
				"api_req_finished",
				JSON.stringify({
					tokensIn: inputTokens,
					tokensOut: outputTokens,
					cacheWrites: cacheCreationInputTokens,
					cacheReads: cacheReadInputTokens,
					cost: this.calculateApiCost(
						inputTokens,
						outputTokens,
						cacheCreationInputTokens,
						cacheReadInputTokens
					),
				})
			)

			// A response always returns text content blocks (it's just that before we were iterating over the completion_attempt response before we could append text response, resulting in bug)
			for (const contentBlock of response.content) {
				// type can only be text or tool_use
				if (contentBlock.type === "text") {
					assistantResponses.push(contentBlock)
					await this.say("text", contentBlock.text)
				} else if (contentBlock.type === "tool_use") {
					assistantResponses.push(contentBlock)
				}
			}

			// need to save assistant responses to file before proceeding to tool use since user can exit at any moment and we wouldn't be able to save the assistant's response
			if (assistantResponses.length > 0) {
				await this.addToApiConversationHistory({ role: "assistant", content: assistantResponses })
			} else {
				// this should never happen! it there's no assistant_responses, that means we got no text or tool_use content blocks from API which we should assume is an error
				await this.say(
					"error",
					"Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output."
				)
				await this.addToApiConversationHistory({
					role: "assistant",
					content: [{ type: "text", text: "Failure: I did not provide a response." }],
				})
			}

			let toolResults: Anthropic.ToolResultBlockParam[] = []
			let attemptCompletionBlock: Anthropic.Messages.ToolUseBlock | undefined
			for (const contentBlock of response.content) {
				if (contentBlock.type === "tool_use") {
					const toolName = contentBlock.name as ToolName
					const toolInput = contentBlock.input
					const toolUseId = contentBlock.id
					if (toolName === "attempt_completion") {
						attemptCompletionBlock = contentBlock
					} else {
						// NOTE: while anthropic sdk accepts string or array of string/image, openai sdk (openrouter) only accepts a string
						const result = await this.executeTool(toolName, toolInput)
						// this.say(
						// 	"tool",
						// 	`\nTool Used: ${toolName}\nTool Input: ${JSON.stringify(toolInput)}\nTool Result: ${result}`
						// )
						toolResults.push({ type: "tool_result", tool_use_id: toolUseId, content: result })
					}
				}
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
					await this.addToApiConversationHistory({ role: "user", content: toolResults })
					await this.addToApiConversationHistory({
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

	// Formatting responses to Claude

	private formatImagesIntoBlocks(images?: string[]): Anthropic.ImageBlockParam[] {
		return images
			? images.map((dataUrl) => {
					// data:image/png;base64,base64string
					const [rest, base64] = dataUrl.split(",")
					const mimeType = rest.split(":")[1].split(";")[0]
					return {
						type: "image",
						source: { type: "base64", media_type: mimeType, data: base64 },
					} as Anthropic.ImageBlockParam
			  })
			: []
	}

	private formatToolResponseWithImages(text: string, images?: string[]): ToolResponse {
		if (images && images.length > 0) {
			const textBlock: Anthropic.TextBlockParam = { type: "text", text }
			const imageBlocks: Anthropic.ImageBlockParam[] = this.formatImagesIntoBlocks(images)
			// Placing images after text leads to better results
			return [textBlock, ...imageBlocks]
		} else {
			return text
		}
	}

	async getPotentiallyRelevantDetails(includeFileDetails: boolean = false) {
		let details = `<potentially_relevant_details>
# VSCode Visible Files
${
	vscode.window.visibleTextEditors
		?.map((editor) => editor.document?.uri?.fsPath)
		.filter(Boolean)
		.map((absolutePath) => path.relative(cwd, absolutePath))
		.join("\n") || "(No files open)"
}

# VSCode Open Tabs
${
	vscode.window.tabGroups.all
		.flatMap((group) => group.tabs)
		.map((tab) => (tab.input as vscode.TabInputText)?.uri?.fsPath)
		.filter(Boolean)
		.map((absolutePath) => path.relative(cwd, absolutePath))
		.join("\n") || "(No tabs open)"
}`

		// Get diagnostics for all open files in the workspace
		// const diagnostics = vscode.languages.getDiagnostics()
		// const relevantDiagnostics = diagnostics.filter(([_, fileDiagnostics]) =>
		// 	fileDiagnostics.some(
		// 		(d) =>
		// 			d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning
		// 	)
		// )

		// if (relevantDiagnostics.length > 0) {
		// 	details += "\n\n# VSCode Workspace Diagnostics"
		// 	for (const [uri, fileDiagnostics] of relevantDiagnostics) {
		// 		const relativePath = path.relative(cwd, uri.fsPath)
		// 		details += `\n## ${relativePath}:`
		// 		for (const diagnostic of fileDiagnostics) {
		// 			if (
		// 				diagnostic.severity === vscode.DiagnosticSeverity.Error ||
		// 				diagnostic.severity === vscode.DiagnosticSeverity.Warning
		// 			) {
		// 				let severity = diagnostic.severity === vscode.DiagnosticSeverity.Error ? "Error" : "Warning"
		// 				const line = diagnostic.range.start.line + 1 // VSCode lines are 0-indexed
		// 				details += `\n- [${severity}] Line ${line}: ${diagnostic.message}`
		// 			}
		// 		}
		// 	}
		// }

		const busyTerminals = this.terminalManager.getTerminals(true)
		if (busyTerminals.length > 0) {
			// wait for terminals to cool down
			await delay(500) // delay after saving file
			await pWaitFor(() => busyTerminals.every((t) => !this.terminalManager.isProcessHot(t.id)), {
				interval: 100,
				timeout: 15_000,
			}).catch(() => {})
			// terminals are cool, let's retrieve their output
			details += "\n\n# Active Terminals"
			for (const busyTerminal of busyTerminals) {
				details += `\n## ${busyTerminal.lastCommand}`
				const newOutput = this.terminalManager.getUnretrievedOutput(busyTerminal.id)
				if (newOutput) {
					details += `\n### New Output\n${newOutput}`
				} else {
					// details += `\n(Still running, no new output)` // don't want to show this right after running the command
				}
			}
		}

		// only show inactive terminals if there's output to show
		const inactiveTerminals = this.terminalManager.getTerminals(false)
		if (inactiveTerminals.length > 0) {
			const inactiveTerminalOutputs = new Map<number, string>()
			for (const inactiveTerminal of inactiveTerminals) {
				const newOutput = this.terminalManager.getUnretrievedOutput(inactiveTerminal.id)
				if (newOutput) {
					inactiveTerminalOutputs.set(inactiveTerminal.id, newOutput)
				}
			}
			if (inactiveTerminalOutputs.size > 0) {
				details += "\n\n# Inactive Terminals"
				for (const [terminalId, newOutput] of inactiveTerminalOutputs) {
					const inactiveTerminal = inactiveTerminals.find((t) => t.id === terminalId)
					if (inactiveTerminal) {
						details += `\n## ${inactiveTerminal.lastCommand}`
						details += `\n### New Output\n${newOutput}`
					}
				}
			}
		}

		if (includeFileDetails) {
			const isDesktop = cwd === path.join(os.homedir(), "Desktop")
			const files = await listFiles(cwd, !isDesktop)
			const result = this.formatFilesList(cwd, files)
			details += `\n\n# Current Working Directory ('${cwd}') Files${
				isDesktop
					? "\n(Desktop so only top-level contents shown for brevity, use list_files to explore further if necessary)"
					: ""
			}\n${result}`
		}

		details += "\n</potentially_relevant_details>"
		return details
	}

	async formatToolDeniedFeedback(feedback?: string) {
		return `The user denied this operation and provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`
	}

	async formatToolDenied() {
		return `The user denied this operation.`
	}

	async formatToolResult(result: string) {
		return result // the successful result of the tool should never be manipulated, if we need to add details it should be as a separate user text block
	}

	async formatToolError(error?: string) {
		return `The tool execution failed with the following error:\n<error>\n${error}\n</error>`
	}

	async sayAndCreateMissingParamError(toolName: ToolName, paramName: string, relPath?: string) {
		await this.say(
			"error",
			`Claude tried to use ${toolName}${
				relPath ? ` for '${relPath}'` : ""
			} without value for required parameter '${paramName}'. Retrying...`
		)
		return await this.formatToolError(
			`Missing value for required parameter '${paramName}'. Please retry with complete response.`
		)
	}
}
