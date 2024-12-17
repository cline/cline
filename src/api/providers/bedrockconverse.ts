import { 
  BedrockRuntimeClient, 
  ConverseStreamCommand,
  ToolConfiguration, 
  Tool,
  AccessDeniedException,
  InternalServerException,
  ModelErrorException,
  ModelNotReadyException,
  ModelTimeoutException,
  ResourceNotFoundException,
  ServiceUnavailableException,
  ThrottlingException,
  ValidationException,
  ConverseStreamOutput
} from "@aws-sdk/client-bedrock-runtime";
import { ApiHandler } from "../"
import { ApiHandlerOptions, bedrockConverseDefaultModelId, BedrockConverseModelId, bedrockConverseModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToBedrock } from "../transform/bedrockconverse-format"
import { Anthropic } from "@anthropic-ai/sdk"

export class AwsBedrockConverseHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: BedrockRuntimeClient

	constructor(options: ApiHandlerOptions) {
		this.options = options

		if (!this.options.awsRegion) {
			throw new Error("AWS region is required for Bedrock Converse")
		}

		this.client = new BedrockRuntimeClient({
			region: this.options.awsRegion,
			credentials: this.options.awsAccessKey && this.options.awsSecretKey
				? {
					accessKeyId: this.options.awsAccessKey,
					secretAccessKey: this.options.awsSecretKey,
					sessionToken: this.options.awsSessionToken,
				}
				: undefined,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const convertedMessages = this.convertMessages(messages)
		const allMessages = [
			{ role: 'system' as const, content: systemPrompt },
			...convertedMessages
		]

		// Get the base request parameters using the original model ID
		const baseRequest = convertToBedrock(allMessages, model.id, {
			temperature: 0,
			max_tokens: model.info.maxTokens || 8192,
			toolConfig: this.getToolConfig()
		})

		// Handle cross-region inference by modifying the modelId in the request if needed
		if (this.options.awsUseCrossRegionInference) {
			let regionPrefix = (this.options.awsRegion || "").slice(0, 3)
			switch (regionPrefix) {
				case "us-":
					baseRequest.modelId = `us.${model.id}`
					break
				case "eu-":
					baseRequest.modelId = `eu.${model.id}`
					break
				// cross region inference is not supported in other regions, keep default model ID
			}
		}

		try {
			const command = new ConverseStreamCommand(baseRequest)
			const response = await this.client.send(command)

			if (!response.stream) {
				throw new Error("No stream in response from Bedrock Converse API")
			}

			let currentText = ""
			let inputTokens = 0
			let outputTokens = 0

			for await (const event of response.stream) {
				// Handle content block delta events (text chunks)
				if ("contentBlockDelta" in event && event.contentBlockDelta?.delta?.text) {
					const text = event.contentBlockDelta.delta.text
					currentText += text
					
					// Convert to Anthropic format for text chunks
					const textBlock: Anthropic.Messages.ContentBlock = {
						type: "text",
						text
					}
					yield {
						type: "text",
						text: textBlock.text,
					}
				}

				// Handle message stop events
				if ("messageStop" in event) {
					if (event.messageStop?.stopReason === "content_filtered") {
						throw new Error("Response was filtered by content moderation")
					}
				}

				// Handle metadata events (usage information)
				if ("metadata" in event && event.metadata?.usage) {
					inputTokens = event.metadata.usage.inputTokens ?? 0
					outputTokens = event.metadata.usage.outputTokens ?? 0

					// Convert to Anthropic format for usage
					yield {
						type: "usage",
						inputTokens,
						outputTokens,
					}
				}
			}
		} catch (error) {
			// Handle specific AWS Bedrock errors
			if (error instanceof AccessDeniedException) {
				throw new Error("Access denied. Please check your AWS credentials and permissions.")
			}
			if (error instanceof InternalServerException) {
				throw new Error("An internal server error occurred in AWS Bedrock.")
			}
			if (error instanceof ModelErrorException) {
				throw new Error("The model encountered an error while processing the request.")
			}
			if (error instanceof ModelNotReadyException) {
				throw new Error("The specified model is not ready to serve inference requests.")
			}
			if (error instanceof ModelTimeoutException) {
				throw new Error("The request timed out while processing.")
			}
			if (error instanceof ResourceNotFoundException) {
				throw new Error("The specified model or resource was not found.")
			}
			if (error instanceof ServiceUnavailableException) {
				throw new Error("AWS Bedrock service is currently unavailable. Please try again later.")
			}
			if (error instanceof ThrottlingException) {
				throw new Error("Request was throttled. Please reduce your request rate.")
			}
			if (error instanceof ValidationException) {
				throw new Error(`Invalid request: ${error.message}`)
			}

			// For unknown errors, throw with a generic message
			throw new Error(error instanceof Error ? error.message : "An unexpected error occurred")
		}
	}

	getModel(): { id: BedrockConverseModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId as BedrockConverseModelId | undefined
		if (modelId && modelId in bedrockConverseModels) {
			return { id: modelId, info: bedrockConverseModels[modelId] }
		}
		return { id: bedrockConverseDefaultModelId, info: bedrockConverseModels[bedrockConverseDefaultModelId] }
	}

	private convertMessages(messages: Anthropic.Messages.MessageParam[]): { role: 'user' | 'assistant'; content: string }[] {
		return messages.map(msg => ({
			role: msg.role,
			content: Array.isArray(msg.content)
				? msg.content.map(c => {
					if ('text' in c && typeof c.text === 'string') {
						return c.text;
					}
					if ('image' in c && typeof c.image === 'object' && c.image && 'source' in c.image && 
						typeof c.image.source === 'object' && c.image.source && 'type' in c.image.source) {
						return `[Image: ${c.image.source.type}]`;
					}
					if ('tool_use' in c && typeof c.tool_use === 'object' && c.tool_use && 
						'name' in c.tool_use && typeof c.tool_use.name === 'string') {
						return `[Tool Use: ${c.tool_use.name}]`;
					}
					if ('tool_result' in c && typeof c.tool_result === 'object' && c.tool_result && 
						'status' in c.tool_result && typeof c.tool_result.status === 'string') {
						return `[Tool Result: ${c.tool_result.status}]`;
					}
					return '';
				}).join('\n')
				: msg.content
		}))
	}

	private getToolConfig(): ToolConfiguration {
		const allTools: Tool[] = [
			{
				toolSpec: {
					name: "execute_command",
					description: "Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands will be executed in the current working directory.",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								command: { 
									type: "string",
									description: "The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions."
								}
							},
							required: ["command"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "read_file",
					description: "Request to read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string.",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								path: { 
									type: "string",
									description: "The path of the file to read (relative to the current working directory)"
								}
							},
							required: ["path"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "write_to_file",
					description: "Request to write content to a file at the specified path. If the file exists, it will be overwritten with the provided content. If the file doesn't exist, it will be created. This tool will automatically create any directories needed to write the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified.",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								path: { 
									type: "string",
									description: "The path of the file to write to (relative to the current working directory)"
								},
								content: { 
									type: "string",
									description: "The content to write to the file. Must be the complete file content, not partial updates."
								}
							},
							required: ["path", "content"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "search_files",
					description: "Request to perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context. Use this for understanding code patterns, finding specific implementations, or identifying areas that need refactoring.",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								path: { 
									type: "string",
									description: "The path of the directory to search in (relative to the current working directory). This directory will be recursively searched."
								},
								regex: { 
									type: "string",
									description: "The regular expression pattern to search for. Uses Rust regex syntax."
								},
								file_pattern: { 
									type: "string",
									description: "Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*)."
								}
							},
							required: ["path", "regex"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "list_files",
					description: "Request to list files and directories within the specified directory. If recursive is true, it will list all files and directories recursively. If recursive is false or not provided, it will only list the top-level contents. Do not use this tool to confirm the existence of files you may have created, as the user will let you know if the files were created successfully or not.",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								path: { 
									type: "string",
									description: "The path of the directory to list contents for (relative to the current working directory)"
								},
								recursive: { 
									type: "boolean",
									description: "Whether to list files recursively. Use true for recursive listing, false or omit for top-level only."
								}
							},
							required: ["path"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "list_code_definition_names",
					description: "Request to list definition names (classes, functions, methods, etc.) used in source code files at the top level of the specified directory. This tool provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								path: { 
									type: "string",
									description: "The path of the directory (relative to the current working directory) to list top level source code definitions for."
								}
							},
							required: ["path"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "browser_action",
					description: "Request to interact with a Puppeteer-controlled browser. Every action, except 'close', will be responded to with a screenshot of the browser's current state, along with any new console logs. You may only perform one browser action per message, and wait for the user's response including a screenshot and logs to determine the next action. The sequence of actions must always start with launching the browser at a URL, and must always end with closing the browser. While the browser is active, only the browser_action tool can be used. The browser window has a resolution of 900x600 pixels.",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								action: { 
									type: "string",
									description: "The action to perform: 'launch' (must be first action), 'click' (at x,y coordinate), 'type' (keyboard input), 'scroll_down', 'scroll_up', or 'close' (must be final action)"
								},
								url: { 
									type: "string",
									description: "The URL to launch the browser at (required for 'launch' action). Must include protocol (e.g., http://, file://)"
								},
								coordinate: { 
									type: "string",
									description: "The X,Y coordinates for click action (e.g., '450,300'). Must be within 900x600 resolution"
								},
								text: { 
									type: "string",
									description: "The text to type for keyboard input action"
								}
							},
							required: ["action"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "ask_followup_question",
					description: "Ask the user a question to gather additional information needed to complete the task. This tool should be used when you encounter ambiguities, need clarification, or require more details to proceed effectively. Use this tool judiciously to maintain a balance between gathering necessary information and avoiding excessive back-and-forth.",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								question: { 
									type: "string",
									description: "The question to ask the user. This should be a clear, specific question that addresses the information you need."
								}
							},
							required: ["question"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "attempt_completion",
					description: "Present the result of your work to the user after confirming all previous tool uses were successful. The result should be final and not require further input. Never end the result with questions or offers for further assistance.",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								result: { 
									type: "string",
									description: "The result of the task. Must be final and not require further input from the user."
								},
								command: { 
									type: "string",
									description: "Optional CLI command to demonstrate the result (e.g., 'open index.html'). Do not use commands that merely print text."
								}
							},
							required: ["result"]
						}
					}
				}
			}
		]

		// Only include browser_action tool if the model supports computer use
		const modelInfo = this.getModel().info
		const tools = modelInfo.supportsComputerUse 
			? allTools 
			: allTools.filter(tool => tool.toolSpec && tool.toolSpec.name !== "browser_action")

		return {
			tools,
			toolChoice: { auto: {} }
		}
	}
}
