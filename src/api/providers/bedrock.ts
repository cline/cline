import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, BedrockModelId, ModelInfo, bedrockDefaultModelId, bedrockModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToBedrockConverseMessages, convertToAnthropicMessage } from "../transform/bedrock-converse-format"

export class AwsBedrockHandler implements ApiHandler {
    private options: ApiHandlerOptions
    private client: BedrockRuntimeClient

    constructor(options: ApiHandlerOptions) {
        this.options = options
        
        // Only include credentials if they actually exist
        const clientConfig: any = {
            region: this.options.awsRegion || "us-east-1"
        }

        if (this.options.awsAccessKey && this.options.awsSecretKey) {
            clientConfig.credentials = {
                accessKeyId: this.options.awsAccessKey,
                secretAccessKey: this.options.awsSecretKey
            }
            
            // Only add sessionToken if it exists
            if (this.options.awsSessionToken) {
                clientConfig.credentials.sessionToken = this.options.awsSessionToken
            }
        }

        this.client = new BedrockRuntimeClient(clientConfig)
    }

    async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
        const modelConfig = this.getModel()
        
        // Handle cross-region inference
        let modelId: string
        if (this.options.awsUseCrossRegionInference) {
            let regionPrefix = (this.options.awsRegion || "").slice(0, 3)
            switch (regionPrefix) {
                case "us-":
                    modelId = `us.${modelConfig.id}`
                    break
                case "eu-":
                    modelId = `eu.${modelConfig.id}`
                    break
                default:
                    modelId = modelConfig.id
                    break
            }
        } else {
            modelId = modelConfig.id
        }

        // Convert messages to Bedrock format
        const formattedMessages = convertToBedrockConverseMessages(messages)

        // Construct the payload
        const payload = {
            modelId,
            messages: formattedMessages,
            system: [{ text: systemPrompt }],
            inferenceConfig: {
                maxTokens: modelConfig.info.maxTokens || 5000,
                temperature: 0.3,
                topP: 0.1,
                ...(this.options.awsusePromptCache ? {
                    promptCache: {
                        promptCacheId: this.options.awspromptCacheId || ""
                    }
                } : {})
            }
        }

        try {
            const command = new ConverseStreamCommand(payload)
            const response = await this.client.send(command)

            if (!response.stream) {
                throw new Error('No stream available in the response')
            }

            for await (const event of response.stream) {
                // Type assertion for the event
                const streamEvent = event as any

                // Handle metadata events first
                if (streamEvent.metadata?.usage) {
                    yield {
                        type: "usage",
                        inputTokens: streamEvent.metadata.usage.inputTokens || 0,
                        outputTokens: streamEvent.metadata.usage.outputTokens || 0
                    }
                    continue
                }

                // Handle message start
                if (streamEvent.messageStart) {
                    continue
                }

                // Handle content blocks
                if (streamEvent.contentBlockStart?.start?.text) {
                    yield {
                        type: "text",
                        text: streamEvent.contentBlockStart.start.text
                    }
                    continue
                }

                // Handle content deltas
                if (streamEvent.contentBlockDelta?.delta?.text) {
                    yield {
                        type: "text",
                        text: streamEvent.contentBlockDelta.delta.text
                    }
                    continue
                }

                // Handle message stop
                if (streamEvent.messageStop) {
                    continue
                }
            }

        } catch (error: any) {
            console.error('Bedrock Runtime API Error:', error)
            console.error('Error stack:', error.stack)
            yield {
                type: "text",
                text: `Error: ${error.message}`
            }
            yield {
                type: "usage",
                inputTokens: 0,
                outputTokens: 0
            }
            throw error
        }
    }

    getModel(): { id: BedrockModelId; info: ModelInfo } {
        const modelId = this.options.apiModelId
        if (modelId && modelId in bedrockModels) {
            const id = modelId as BedrockModelId
            return { id, info: bedrockModels[id] }
        }
        return { 
            id: bedrockDefaultModelId, 
            info: bedrockModels[bedrockDefaultModelId] 
        }
    }
}
