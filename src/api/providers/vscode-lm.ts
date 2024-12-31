import * as vscode from 'vscode';

import { ApiHandler } from "../";
import { calculateApiCost } from "../../utils/cost";
import { ApiStream } from "../transform/stream";
import { convertToVsCodeLmMessages } from "../transform/vscode-lm-format";
import { SELECTOR_SEPARATOR, stringifyVsCodeLmModelSelector } from "../../shared/vsCodeSelectorUtils";
import {
    ApiHandlerOptions,
    ModelInfo,
    MessageParamWithTokenCount,
    openAiModelInfoSaneDefaults
} from "../../shared/api";

// Cline does not update VSCode type definitions or engine requirements to maintain compatibility.
// This declaration (as seen in src/integrations/TerminalManager.ts) provides types for the Language Model API in newer versions of VSCode.
// Extracted from https://github.com/microsoft/vscode/blob/131ee0ef660d600cd0a7e6058375b281553abe20/src/vscode-dts/vscode.d.ts
declare module "vscode" {
    enum LanguageModelChatMessageRole {
        User = 1,
        Assistant = 2
    }
    enum LanguageModelChatToolMode {
        Auto = 1,
        Required = 2
    }
    interface LanguageModelChatSelector {
        vendor?: string;
        family?: string;
        version?: string;
        id?: string;
    }
    interface LanguageModelChatTool {
        name: string;
        description: string;
        inputSchema?: object;
    }
    interface LanguageModelChatRequestOptions {
        justification?: string;
        modelOptions?: { [name: string]: any; };
        tools?: LanguageModelChatTool[];
        toolMode?: LanguageModelChatToolMode;
    }
    class LanguageModelTextPart {
        value: string;
        constructor(value: string);
    }
    class LanguageModelToolCallPart {
        callId: string;
        name: string;
        input: object;
        constructor(callId: string, name: string, input: object);
    }
    interface LanguageModelChatResponse {
        stream: AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart | unknown>;
        text: AsyncIterable<string>;
    }
    interface LanguageModelChat {
        readonly name: string;
        readonly id: string;
        readonly vendor: string;
        readonly family: string;
        readonly version: string;
        readonly maxInputTokens: number;

        sendRequest(messages: LanguageModelChatMessage[], options?: LanguageModelChatRequestOptions, token?: CancellationToken): Thenable<LanguageModelChatResponse>;
        countTokens(text: string | LanguageModelChatMessage, token?: CancellationToken): Thenable<number>;
    }
    class LanguageModelPromptTsxPart {
        value: unknown;
        constructor(value: unknown);
    }
    class LanguageModelToolResultPart {
        callId: string;
        content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart | unknown>;
        constructor(callId: string, content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart | unknown>);
    }
    class LanguageModelChatMessage {
        static User(content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart>, name?: string): LanguageModelChatMessage;
        static Assistant(content: string | Array<LanguageModelTextPart | LanguageModelToolCallPart>, name?: string): LanguageModelChatMessage;

        role: LanguageModelChatMessageRole;
        content: Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>;
        name: string | undefined;

        constructor(role: LanguageModelChatMessageRole, content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>, name?: string);
    }
    namespace lm {
        function selectChatModels(selector?: LanguageModelChatSelector): Thenable<LanguageModelChat[]>;
    }
}

const ERROR_PREFIX = 'Cline <Language Model API>';

export class VsCodeLmHandler implements ApiHandler {

    private options: ApiHandlerOptions;
    private client: vscode.LanguageModelChat | null;
    private configurationWatcher: vscode.Disposable | null;
    private currentRequestCancellation: vscode.CancellationTokenSource | null;

    constructor(options: ApiHandlerOptions) {

        this.options = options;
        this.client = null;
        this.configurationWatcher = null;
        this.currentRequestCancellation = null;

        try {

            // Set up configuration change listener with proper error boundary
            this.configurationWatcher = vscode.workspace.onDidChangeConfiguration(
                (event: vscode.ConfigurationChangeEvent): void => {

                    try {

                        if (event.affectsConfiguration('lm')) {

                            this.releaseCurrentCancellation();
                            this.client = null;
                        }
                    }
                    catch (listenerError) {

                        console.warn(
                            'Cline <Language Model API>: Error handling configuration change:',
                            listenerError instanceof Error ? listenerError.message : 'Unknown error'
                        );
                    }
                }
            );
        }
        catch (error) {

            // Clean up resources if initialization fails
            this.dispose();

            throw new Error(
                `Cline <Language Model API>: Failed to initialize handler: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    dispose(): void {

        // Clean up resources in a deterministic order
        this.releaseCurrentCancellation();

        if (this.configurationWatcher) {

            this.configurationWatcher.dispose();
            this.configurationWatcher = null;
        }

        this.client = null; // Release client reference
    }

    private releaseCurrentCancellation(): void {

        if (this.currentRequestCancellation) {

            this.currentRequestCancellation.cancel();
            this.currentRequestCancellation.dispose();
            this.currentRequestCancellation = null;
        }
    }

    private async selectBestModel(selector: vscode.LanguageModelChatSelector): Promise<vscode.LanguageModelChat> {

        const models: vscode.LanguageModelChat[] = await vscode.lm.selectChatModels(selector);
        
        if (models.length === 0) {

            throw new Error(`${ERROR_PREFIX} No models found matching the specified selector.`);
        }

        return models.reduce(
            (
                (best, current) => 
                    current.maxInputTokens > best.maxInputTokens ? current : best
            ), 
            models[0]
        );
    }

    private async getClient(): Promise<vscode.LanguageModelChat> {

        if (!this.options.vsCodeLmModelSelector) {

            throw new Error(`${ERROR_PREFIX} The 'vsCodeLmModelSelector' option is required for the 'vscode-lm' provider.`);
        }

        if (!this.client) {

            try {

                this.client = await this.selectBestModel(this.options.vsCodeLmModelSelector);
            }
            catch (error) {

                throw new Error(`${ERROR_PREFIX} Failed to create client: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }

        return this.client;
    }

    private async *processStreamChunks(response: vscode.LanguageModelChatResponse, contentBuilder: string[]): ApiStream {

        for await (const chunk of response.stream) {

            if (this.currentRequestCancellation?.token.isCancellationRequested) {

                throw new vscode.CancellationError();
            }

            if (chunk instanceof vscode.LanguageModelTextPart) {

                contentBuilder.push(chunk.value);

                yield {
                    type: "text" as const,
                    text: chunk.value
                };
            }
        }
    }

    private async calculateInputTokens(systemPrompt: string, messages: MessageParamWithTokenCount[]): Promise<number> {

        let totalTokens: number = await this.countTokens(systemPrompt);

        for (const msg of messages) {

            if (msg.tokenCount !== undefined) {

                totalTokens += msg.tokenCount;
                continue;
            }

            const messageContent: string = Array.isArray(msg.content)
                ? msg.content
                    .filter(block => block.type === "text")
                    .map(block => block.text)
                    .join("\n")
                : msg.content;

            const tokenCount: number = await this.countTokens(messageContent);
            msg.tokenCount = tokenCount;
            totalTokens += tokenCount;
        }

        return totalTokens;
    }

    private async countTokens(text: string | vscode.LanguageModelChatMessage): Promise<number> {

        // Early exit if client or cancellation token is missing
        if (!this.client || !this.currentRequestCancellation) {

            return 0;
        }

        try {

            // Count tokens
            const tokenCount: number = await this.client.countTokens(
                text,
                this.currentRequestCancellation.token
            );

            return tokenCount;
        }
        catch (error) {

            // Re-throw cancellation errors
            if (error instanceof vscode.CancellationError) {

                throw error;
            }

            // Soft fail on token counting errors that are not manually cancelled
            console.warn('Token counting failed:', error);
            return 0;
        }
    }

    async *createMessage(systemPrompt: string, messages: MessageParamWithTokenCount[]): ApiStream {

        try {

            this.releaseCurrentCancellation();
            
            const client: vscode.LanguageModelChat = await this.getClient();
            const model = this.getModel();
            this.currentRequestCancellation = new vscode.CancellationTokenSource();

            const totalInputTokens: number = await this.calculateInputTokens(systemPrompt, messages);
            const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = [
                vscode.LanguageModelChatMessage.Assistant(systemPrompt),
                ...convertToVsCodeLmMessages(messages)
            ];

            const contentBuilder: string[] = [];
            try {

                const response: vscode.LanguageModelChatResponse = await client.sendRequest(
                    vsCodeLmMessages,
                    {
                        justification: `${client.name} from ${client.vendor} will be used by Cline.\n\nClick 'Allow' to proceed.`
                    },
                    this.currentRequestCancellation.token
                );

                const streamGenerator: ApiStream = await this.processStreamChunks(response, contentBuilder);
                for await (const chunk of streamGenerator) {

                    yield chunk;
                }

                const outputTokens: number = await this.countTokens(contentBuilder.join(''));

                yield {
                    type: "usage",
                    inputTokens: totalInputTokens,
                    outputTokens,
                    totalCost: calculateApiCost(
                        model.info,
                        totalInputTokens,
                        outputTokens
                    )
                };
            }
            catch (error) {

                if (error instanceof vscode.CancellationError) {
                    throw new Error(`${ERROR_PREFIX}: Request cancelled by user`);
                }

                throw error;
            }
        }
        catch (error) {

            this.releaseCurrentCancellation();

            throw new Error(
                `${ERROR_PREFIX}: Response stream error: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    getModel(): { id: string; info: ModelInfo; } {

        if (!this.client) {

            return {
                id: this.options.vsCodeLmModelSelector
                    ? stringifyVsCodeLmModelSelector(this.options.vsCodeLmModelSelector)
                    : "vscode-lm",
                info: openAiModelInfoSaneDefaults
            };
        }

        const modelId: string = (
            this.client.id
            || (
                [this.client.vendor, this.client.family]
                    .filter(Boolean)
                    .join(SELECTOR_SEPARATOR)
            )
            || "vscode-lm-unknown"
        );

        return {
            id: modelId,
            info: {
                maxTokens: -1,
                contextWindow: Math.max(0, this.client.maxInputTokens),
                supportsImages: false,
                supportsPromptCache: false,
                inputPrice: 0,
                outputPrice: 0
            }
        };
    }
}
