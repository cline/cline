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

const SYSTEM_PROMPT = `You are Claude Dev, an exceptional software developer with vast knowledge across multiple programming languages, frameworks, and best practices.

====
 
CAPABILITIES

- You can read and analyze code in various programming languages, and can write clean, efficient, and well-documented code.
- You can debug complex issues and providing detailed explanations, offering architectural insights and design patterns.
- You have access to tools that let you execute CLI commands on the user's computer, list files in a directory, read and write files, and ask follow-up questions. These tools help you effectively accomplish a wide range of tasks, such as writing code, making edits or improvements to existing files, understanding the current state of a project, performing system operations, and much more.
    - For example, when asked to make edits or improvements you might use the read_file tool to examine the contents of relevant files, analyze the code and suggest improvements or make necessary edits, then use the write_to_file tool to implement changes.
- The execute_command tool lets you run commands on the user's computer and should be used whenever you feel it can help accomplish the user's task. When you need to execute a CLI command, you must provide a clear explanation of what the command does. Prefer to execute complex CLI commands over creating executable scripts, since they are more flexible and easier to run.

====

RULES

- When editing files, always provide the full content of the file, even if you're only changing a small part. The system will automatically generate and apply the appropriate diff.
- Always read a file before editing it if you are missing content. This will help you understand the context and make more informed changes.
- Before using the execute_command tool, you must first think about the System Information context provided by the user to understand their environment and tailor your commands to ensure they are compatible with the user's system.
- When using the execute_command tool, avoid running servers or executing commands that don't terminate on their own (e.g. Flask web servers, continuous scripts). If a task requires such a process or server, explain in your task completion result why you can't execute it directly and provide clear instructions on how the user can run it themselves.
- When creating a new project (such as an app, website, or any software project), unless the user specifies otherwise, organize all new files within a dedicated project directory. Use appropriate file paths when writing files, as the write_to_file tool will automatically create any necessary directories. Structure the project logically, adhering to best practices for the specific type of project being created.
- You must try to use multiple tools in one request when possible. For example if you were to create a website, you would use the write_to_file tool to create the necessary files with their appropriate contents all at once. Or if you wanted to analyze a project, you could use the read_file tool to read multiple files at once. This will help you accomplish the user's task more efficiently.
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
5. When you've completed the user's task, you must use the attempt_completion tool to present the result of the task to the user. The user may provide feedback, which you can use to make improvements and try again. But DO NOT continue in pointless back and forth conversations, i.e. don't end your responses with questions or offers for further assistance.
`

const tools: Tool[] = [
	{
		name: "execute_command",
		description:
			"Execute a CLI command. Use this when you need to perform system operations or run specific commands.",
		input_schema: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: "The CLI command to execute",
				},
			},
			required: ["command"],
		},
	},
	{
		name: "list_files",
		description: "Recursively lists the relative paths of all files in a given directory and its subdirectories.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"The directory path to start listing files from. If not provided, defaults to the current directory ('.')",
				},
			},
		},
	},
	{
		name: "read_file",
		description:
			"Read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file.",
		input_schema: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "The path of the file to read",
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
					description: "The path of the file to write to",
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
			"Ask the user a question to help you complete your task. Use this when you need more information to proceed.",
		input_schema: {
			type: "object",
			properties: {
				question: {
					type: "string",
					description: "The question to ask the user",
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
				result: {
					type: "string",
					description: "The result of the task",
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

	constructor(apiKey: string, maxRequestsPerTask?: number) {
		this.client = new Anthropic({ apiKey })
		this.maxRequestsPerTask = maxRequestsPerTask ?? DEFAULT_MAX_REQUESTS_PER_TASK
	}

    updateApiKey(apiKey: string) {
        this.client = new Anthropic({ apiKey })
    }

    updateMaxRequestsPerTask(maxRequestsPerTask: number) {
        this.maxRequestsPerTask = maxRequestsPerTask
    }

	async ask(type: "request_limit_reached" | "followup" | "command" | "completion_result", question: string): Promise<string> {
		return ""
	}

	async say(type: "error" | "api_cost" | "text" | "tool" | "command_output" | "completed", question: string): Promise<undefined> {
		// send message asyncronously
		return
	}

	async startNewTask(task: string): Promise<void> {
		this.conversationHistory = []
		this.requestCount = 0
		// Get all relevant context for the task
		const filesInCurrentDir = await this.listFiles()

		// This first message kicks off a task, it is not included in every subsequent message. This is a good place to give all the relevant context to a task, instead of having Claude request for it using tools.
		let userPrompt = `# Task
\"${task}\"
====
# Auto-generated Context (may or may not be relevant to the task)
## System Information
Operating System: ${osName()}
Default Shell: ${defaultShell}
Current Working Directory: ${process.cwd()}
## Files in Current Directory
${filesInCurrentDir}`

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

			const totalCost = this.calculateApiCost(totalInputTokens, totalOutputTokens)
			if (didCompleteTask) {
				this.say("completed", `Task completed. Total API usage cost: ${totalCost}`)
				break
			} else {
				this.say(
					"tool",
					"Claude responded with only text blocks but has not called attempt_completion yet. Forcing him to continue with task..."
				)
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
				return this.listFiles(toolInput.path || ".")
			case "execute_command":
				return this.executeCommand(toolInput.command)
			case "ask_followup_question":
				return this.askFollowupQuestion(toolInput.question)
			case "attempt_completion":
				return this.attemptCompletion(toolInput.result)
			default:
				return `Unknown tool: ${toolName}`
		}
	}

	// Calculates cost of a Claude 3.5 Sonnet API request
	calculateApiCost(inputTokens: number, outputTokens: number): string {
		const INPUT_COST_PER_MILLION = 3.0 // $3 per million input tokens
		const OUTPUT_COST_PER_MILLION = 15.0 // $15 per million output tokens
		const inputCost = (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION
		const outputCost = (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION
		const totalCost = inputCost + outputCost
		return `$${totalCost.toFixed(4)}`
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
					return `Changes applied to ${filePath}:\n${diffResult}`
				} else {
					return `Tool succeeded, however there were no changes detected to ${filePath}`
				}
			} else {
				await fs.mkdir(path.dirname(filePath), { recursive: true })
				await fs.writeFile(filePath, newContent)
				return `New file created and content written to ${filePath}`
			}
		} catch (error) {
			const errorString = `Error writing file: ${JSON.stringify(serializeError(error))}`
            this.say("error", errorString)
			return errorString
		}
	}

	async readFile(filePath: string): Promise<string> {
		try {
			return await fs.readFile(filePath, "utf-8")
		} catch (error) {
            const errorString = `Error reading file: ${JSON.stringify(serializeError(error))}`
            this.say("error", errorString)
			return errorString
		}
	}

	async listFiles(dirPath: string = "."): Promise<string> {
		try {
			const dirsToIgnore = [
				"node_modules",
				"build",
				"coverage",
				"public",
				"__pycache__",
				"env",
				"venv",
				"target",
				"bin",
				"dist",
				"out",
				"bundle",
				"vendor",
				"tmp",
				"temp",
				"packages",
				"_build",
				"deps",
				"Pods",
				"migrations",
			]
			const options = {
				cwd: dirPath,
				ignore: dirsToIgnore.map((dir) => `**/${dir}/**`),
				dot: false, // Allow patterns to match files/directories that start with '.', even if the pattern does not start with '.'
				mark: true, // Append a / on any directories matched
			}
			// * globs all files in one dir, ** globs files in nested directories
			const entries = await glob("**", options)
			return entries.slice(1, 501).join("\n") // truncate to 500 entries (removes first entry which is the directory itself)
		} catch (error) {
            const errorString = `Error listing files and directories: ${JSON.stringify(serializeError(error))}`
            this.say("error", errorString)
			return errorString
		}
	}

	async executeCommand(command: string): Promise<string> {
        const answer = await this.ask("command", `Claude wants to execute the following command:\n${command}\nDo you approve? (yes/no):`)
        if (answer.toLowerCase() !== "yes") {
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
			let errorMessage = error.message || JSON.stringify(serializeError(error))
            const errorString = `Error executing command:\n${errorMessage}`
            this.say("error", errorString)
			return errorString
		}
	}

	async askFollowupQuestion(question: string): Promise<string> {
		const answer = await this.ask("followup", question)
		return `User's response:\n\"${answer}\"`
	}

	async attemptCompletion(result: string): Promise<string> {
		const feedback = await this.ask("completion_result", result)
		// Are you satisfied with the result(yes/if no then provide feedback):
		if (feedback.toLowerCase() === "yes") {
			return ""
		}
		return `The user is not pleased with the results. Use the feedback they provided to successfully complete the task, and then attempt completion again.\nUser's feedback:\n\"${feedback}\"`
	}

	async recursivelyMakeClaudeRequests(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): Promise<ClaudeRequestResult> {
		this.conversationHistory.push({ role: "user", content: userContent })
		if (this.requestCount >= this.maxRequestsPerTask) {
			const answer = await this.ask(
				"request_limit_reached",
				`\nClaude has exceeded ${this.maxRequestsPerTask} requests for this task! Would you like to reset the count and proceed? (yes/no):`
			)

			if (answer.toLowerCase() === "yes") {
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
			await this.say("api_cost", `API request cost: ${this.calculateApiCost(inputTokens, outputTokens)}`)

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
						this.say(
							"tool",
							`\nTool Used: ${toolName}\nTool Input: ${JSON.stringify(toolInput)}\nTool Result: ${result}`
						)
						toolResults.push({ type: "tool_result", tool_use_id: toolUseId, content: result })
					}
				}
			}

			if (assistantResponses.length > 0) {
				this.conversationHistory.push({ role: "assistant", content: assistantResponses })
			} else {
				// this should never happen! it there's no assistant_responses, that means we got no text or tool_use content blocks from API which we should assume is an error
				this.say("error", "Error: No assistant responses found in API response!")
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
				this.say(
					"tool",
					`\nattempt_completion Tool Used: ${attemptCompletionBlock.name}\nTool Input: ${JSON.stringify(
						attemptCompletionBlock.input
					)}\nTool Result: ${result}`
				)
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
			this.say("error", `Error calling Claude API: ${JSON.stringify(serializeError(error))}`)
			return { didCompleteTask: true, inputTokens: 0, outputTokens: 0 }
		}
	}
}
