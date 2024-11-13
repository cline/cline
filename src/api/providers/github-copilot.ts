import { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs"
import { ApiHandler } from "../"
import { ApiHandlerOptions, githHubCopilotDefaultModelId, GithHubCopilotModelId, githHubCopilotModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { LanguageModelChat, lm } from "vscode"
import { LanguageModelChatMessage } from "vscode"
import { CancellationTokenSource } from "vscode"
import { LanguageModelTextPart } from "vscode"

export class GithHubCopilotHandler implements ApiHandler {
    private options: ApiHandlerOptions
    private client!: LanguageModelChat

    constructor(options: ApiHandlerOptions) {
        this.options = options
    }

    private getCopilotModel(githubCopilotModelId: string | undefined, callback: (client: LanguageModelChat) => void): void {
        lm.selectChatModels({
            ...(githubCopilotModelId ? { id: githubCopilotModelId } : {})
        })
            .then((clients) => {
                if (clients.length > 0) {
                    callback(clients[0])
                } else {
                    this.getCopilotModel(undefined, callback)
                }
            })
    }

    async *createMessage(systemPrompt: string, messages: MessageParam[]): ApiStream {
        if (!this.client) {
            this.client = await new Promise((resolve) => {
                this.getCopilotModel(this.options.githubCopilotModelId, (client) => {
                    resolve(client)
                })
            });
        }
        const lmChatMessages = [
            LanguageModelChatMessage.User(systemPrompt)
        ]
        for (const message of messages) {
            if (typeof (message.content) === 'string') {
                lmChatMessages.push(LanguageModelChatMessage.User(message.content))
            } else {
                if (message.role === 'user') {
                    for (const content of message.content) {
                        if (content.type === 'text') {
                            lmChatMessages.push(LanguageModelChatMessage.User(content.text))
                        } else {
                        }
                    }
                } else if (message.role === 'assistant') {
                    for (const content of message.content) {
                        if (content.type === 'text') {
                            lmChatMessages.push(LanguageModelChatMessage.Assistant(content.text))
                        } else {
                        }
                    }
                }
            }
        }
        const strema = await this.client.sendRequest(
            lmChatMessages,
            {
                justification: "I want to see what you can do with this.",
                modelOptions: {
                    temperature: 0,
                }
            },
            new CancellationTokenSource().token
        )
        for await (const message of strema.stream) {
            if (message instanceof LanguageModelTextPart) {
                yield {
                    type: "text",
                    text: message.value
                }
            }
        }
    }
    getModel(): { id: GithHubCopilotModelId; info: ModelInfo } {
        const modelId = this.options.apiModelId
        if (modelId && modelId in githHubCopilotModels) {
            const id = modelId as GithHubCopilotModelId
            return { id, info: githHubCopilotModels[id] }
        }
        return { id: githHubCopilotDefaultModelId, info: githHubCopilotModels[githHubCopilotDefaultModelId] }
    }

}