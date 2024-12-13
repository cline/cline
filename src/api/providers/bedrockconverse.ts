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
import { convertToBedrock, convertBedrockResponseToAnthropic } from "../transform/bedrock-format"
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
			let stopReason: string | undefined

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
					stopReason = event.messageStop?.stopReason
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

			// At the end of the stream, construct a complete Anthropic message
			const anthropicMessage: Anthropic.Messages.Message = {
				id: `msg_${Date.now()}`,
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: currentText }],
				model: model.id,
				stop_reason: this.convertStopReason(stopReason),
				stop_sequence: null,
				usage: {
					input_tokens: inputTokens,
					output_tokens: outputTokens,
				},
			}

			// No need to yield the full message since we've already streamed it chunk by chunk
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

	private convertStopReason(reason: string | undefined): Anthropic.Messages.Message["stop_reason"] {
		if (!reason) return null;
		
		switch (reason) {
			case 'end_turn':
				return 'end_turn';
			case 'max_tokens':
				return 'max_tokens';
			case 'stop_sequence':
				return 'stop_sequence';
			case 'content_filtered':
			case 'guardrail_intervened':
			case 'tool_use':
				// These don't have direct mappings in Anthropic's types, 
				// but stop_sequence is the closest semantic match
				return 'stop_sequence';
			default:
				return null;
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
					description: "Execute a CLI command on the system",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								command: { type: "string" }
							},
							required: ["command"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "read_file",
					description: "Read the contents of a file",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								path: { type: "string" }
							},
							required: ["path"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "write_to_file",
					description: "Write content to a file",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								path: { type: "string" },
								content: { type: "string" }
							},
							required: ["path", "content"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "search_files",
					description: "Perform a regex search across files",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								path: { type: "string" },
								regex: { type: "string" },
								file_pattern: { type: "string" }
							},
							required: ["path", "regex"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "list_files",
					description: "List files and directories",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								path: { type: "string" },
								recursive: { type: "boolean" }
							},
							required: ["path"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "list_code_definition_names",
					description: "List definition names in source code files",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								path: { type: "string" }
							},
							required: ["path"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "browser_action",
					description: "Interact with a Puppeteer-controlled browser",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								action: { type: "string" },
								url: { type: "string" },
								coordinate: { type: "string" },
								text: { type: "string" }
							},
							required: ["action"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "ask_followup_question",
					description: "Ask the user a follow-up question",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								question: { type: "string" }
							},
							required: ["question"]
						}
					}
				}
			},
			{
				toolSpec: {
					name: "attempt_completion",
					description: "Present the result of the task",
					inputSchema: {
						json: {
							type: "object",
							properties: {
								result: { type: "string" },
								command: { type: "string" }
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
