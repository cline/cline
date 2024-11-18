import { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs"
import { ApiHandler } from ".."
import { ApiHandlerOptions, githHubCopilotNativeDefaultModelId, GithHubCopilotNativeModelId, githHubCopilotNativeModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import * as vscode from 'vscode'

// Backward compatibility for vscode.d.ts
declare module "vscode" {
    // https://github.com/microsoft/vscode/blob/a370576a871658dcb36b4d112636fa2501fda313/src/vscode-dts/vscode.d.ts#L19625
    namespace lm {
        function selectChatModels(selector: { id?: string }): Thenable<LanguageModelChat[]>
    }
    // https://github.com/microsoft/vscode/blob/a370576a871658dcb36b4d112636fa2501fda313/src/vscode-dts/vscode.d.ts#L19316
    namespace LanguageModelChatMessage {
        function User(text: string): string
        function Assistant(text: string): string
    }
    // https://github.com/microsoft/vscode/blob/a370576a871658dcb36b4d112636fa2501fda313/src/vscode-dts/vscode.d.ts#L19413
    interface LanguageModelChat {
        sendRequest(messages: string[], options: any, token: any): Promise<any>
    }
}

export class GithHubCopilotNativeHandler implements ApiHandler {
    private options: ApiHandlerOptions
    private client!: vscode.LanguageModelChat

    constructor(options: ApiHandlerOptions) {
        this.options = options
    }

    private getCopilotModel(githubCopilotModelId: string | undefined, callback: (client?: vscode.LanguageModelChat) => void, maxRetry = 3): void {
        const llmSelector = { ...(githubCopilotModelId ? { id: githubCopilotModelId } : {}) }
        vscode.lm.selectChatModels(llmSelector)
            .then((models) => {
                if (models.length > 0) {
                    callback(models[0])
                } else {
                    if (maxRetry > 0) {
                        this.getCopilotModel(undefined, callback, maxRetry - 1)
                    } else {
                        callback(undefined)
                    }
                }
            })
    }

    async *createMessage(systemPrompt: string, messages: MessageParam[]): ApiStream {
        if(!vscode.lm.selectChatModels){
            throw new Error('Language Model API not available in this version of VS Code, update it to >=1.91.0')
        }
        if (!this.client) {
            this.client = await new Promise((resolve, reject) => {
                this.getCopilotModel(this.getModel().id, (client) => {
                    if (!client) {
                        reject(new Error('No model is available from Github Copilot at this moment. Please try again later.'))
                    } else {
                        resolve(client)
                    }
                })
            });
        }
        const lmChatMessages = [
            vscode.LanguageModelChatMessage.User(systemPrompt)
        ]
        for (const message of messages) {
            if (typeof (message.content) === 'string') {
                lmChatMessages.push(vscode.LanguageModelChatMessage.User(message.content))
            } else {
                if (message.role === 'user') {
                    for (const content of message.content) {
                        if (content.type === 'text') {
                            lmChatMessages.push(vscode.LanguageModelChatMessage.User(content.text))
                        } else {
                        }
                    }
                } else if (message.role === 'assistant') {
                    for (const content of message.content) {
                        if (content.type === 'text') {
                            lmChatMessages.push(vscode.LanguageModelChatMessage.Assistant(content.text))
                        } else {
                        }
                    }
                }
            }
        }
        const strema = await this.client.sendRequest(
            lmChatMessages,
            {
                justification: "Cline want to use your GitHub Copilot, Click 'Allow' to share it with Cline",
                modelOptions: {
                    temperature: 0,
                },
            },
            new vscode.CancellationTokenSource().token
        )
        for await (const message of strema.stream) {
            if (message && message.value) {
                yield {
                    type: "text",
                    text: message.value
                }
            }
        }
    }

    getModel(): { id: GithHubCopilotNativeModelId; info: ModelInfo } {
        const modelId = this.options.apiModelId
        if (modelId && modelId in githHubCopilotNativeModels) {
            const id = modelId as GithHubCopilotNativeModelId
            return { id, info: githHubCopilotNativeModels[id] }
        }
        return { id: githHubCopilotNativeDefaultModelId, info: githHubCopilotNativeModels[githHubCopilotNativeDefaultModelId] }
    }

}