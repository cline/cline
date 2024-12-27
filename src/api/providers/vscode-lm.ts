import { Anthropic } from "@anthropic-ai/sdk";
import * as vscode from 'vscode';

import { ApiHandler } from "../";

import { calculateApiCost } from "../../utils/cost";

import { ApiStream } from "../transform/stream";
import { convertToVsCodeLmMessages } from "../transform/vscode-lm-format";

import { SELECTOR_SEPARATOR, stringifyVsCodeLmModelSelector } from "../../shared/vsCodeSelectorUtils";
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api";

// Limit token cache size to prevent unbounded growth
// TODO: Should be configurable (either trough the webview, or the user options) if this caching system works as expected
export const MAX_TOKEN_COUNT_CACHE_SIZE: number = 1000 as const;

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

export class VsCodeLmHandler implements ApiHandler {

    private options: ApiHandlerOptions;
    private client: vscode.LanguageModelChat | null;
    private configurationWatcher: vscode.Disposable | null;
    private currentRequestCancellation: vscode.CancellationTokenSource | null;

    // Use WeakMap for caching to prevent memory leaks
    private tokenCountCache: Map<string, number>;
    private tokenCountCacheSize: number = 0;

    constructor(options: ApiHandlerOptions) {

        this.options = options;
        this.client = null;
        this.configurationWatcher = null;
        this.currentRequestCancellation = null;
        this.tokenCountCache = new Map<string, number>();

        try {

            // Set up configuration change listener with proper error boundary
            this.configurationWatcher = vscode.workspace.onDidChangeConfiguration(
                (event: vscode.ConfigurationChangeEvent): void => {

                    try {
    
                        if (event.affectsConfiguration('lm')) {
    
                            this.releaseCurrentCancellation();
                            this.clearTokenCache();
                            
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
        this.clearTokenCache();

        if (this.configurationWatcher) {

            this.configurationWatcher.dispose();
            this.configurationWatcher = null;
        }

        this.client = null; // Release client reference
    }

    private getTokenCountCacheKey(message: vscode.LanguageModelChatMessage): string {
        
        // There is no message ID or hash available, so we use a dirty string representation
        return `${message.role}:${JSON.stringify(message.content)}`;
    }

    private releaseCurrentCancellation(): void {

        if (this.currentRequestCancellation) {

            this.currentRequestCancellation.cancel();
            this.currentRequestCancellation.dispose();
            this.currentRequestCancellation = null;
        }
    }

    private clearTokenCache(): void {

        this.tokenCountCache.clear();
        this.tokenCountCacheSize = 0;
    }

    private async selectBestModel(selector: vscode.LanguageModelChatSelector): Promise<vscode.LanguageModelChat> {

        const models = await vscode.lm.selectChatModels(selector);

        if (models.length === 0) {

            throw new Error(
                "Cline <Language Model API>: No models found matching the specified selector."
            );
        }

        // Select model with highest token limit if multiple models available
        return models.reduce(
            (best, current) => (
                (current.maxInputTokens > best.maxInputTokens) ? current : best
            ),
            models[0]
        );
    }

    private async getClient(): Promise<vscode.LanguageModelChat> {

        // Early validation of required options
        if (!this.options.vsCodeLmModelSelector) {

            throw new Error(
                "Cline <Language Model API>: The 'vsCodeLmModelSelector' option is required for the 'vscode-lm' provider."
            );
        }

        // Only create new client if needed
        if (!this.client) {

            try {

                this.client = await this.selectBestModel(this.options.vsCodeLmModelSelector);
            }
            catch (error) {

                const message = error instanceof Error ? error.message : 'Unknown error';
                throw new Error(`Cline <Language Model API>: Failed to create client: ${message}`);
            }
        }

        return this.client;
    }

    private async countTokens(text: string | vscode.LanguageModelChatMessage): Promise<number> {

        // Early exit if client or cancellation token is missing
        if (!this.client || !this.currentRequestCancellation) {

            return 0;
        }
    
        try {

            // Check cache for LanguageModelChatMessage
            if (text instanceof vscode.LanguageModelChatMessage) {

                const cacheKey: string = this.getTokenCountCacheKey(text);
                const cached: number | undefined = this.tokenCountCache.get(cacheKey);

                if (cached !== undefined) {
                    
                    // Move the accessed key to the end to maintain LRU order
                    this.tokenCountCache.delete(cacheKey);
                    this.tokenCountCache.set(cacheKey, cached);
                    return cached;
                }
            }
    
            // Count tokens
            const tokenCount: number = await this.client.countTokens(
                text,
                this.currentRequestCancellation.token
            );
    
            // Cache result if applicable and within size limits
            if (text instanceof vscode.LanguageModelChatMessage) {

                const cacheKey: string = this.getTokenCountCacheKey(text);

                // Sliding window cache eviction strategy
                if (this.tokenCountCacheSize >= MAX_TOKEN_COUNT_CACHE_SIZE) {

                    // Remove the first (least recently used) item
                    const firstKey = this.tokenCountCache.keys().next().value;
                    this.tokenCountCache.delete(firstKey);
                    this.tokenCountCacheSize--;
                }

                // Add the new item
                this.tokenCountCache.set(cacheKey, tokenCount);
                this.tokenCountCacheSize++;
            }
    
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

    async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {

        try {

            // Ensure clean cancellation state before starting a new request
            this.releaseCurrentCancellation();

            // Get client, model and initialize the cancellation token for the request
            const client: vscode.LanguageModelChat = await this.getClient();
            const model = this.getModel();
            this.currentRequestCancellation = new vscode.CancellationTokenSource();

            // Convert messages and initialize token counting
            const vsCodeLmMessages = [
                vscode.LanguageModelChatMessage.Assistant(systemPrompt),
                ...convertToVsCodeLmMessages(messages),
            ];

            // Efficiently count input tokens in parallel
            const inputTokensCounts: number[] = await Promise.all(
                vsCodeLmMessages.map(msg => this.countTokens(msg))
            );

            // Sum input tokens count results
            const inputTokens = inputTokensCounts.reduce((sum, count) => sum + count, 0);

            // Accumulate the output content in order to count tokens and report usage at the end of the stream
            // Use StringBuilder pattern for better memory efficiency (Strings are immutable, Arrays are not)
            const contentBuilder = new Array<string>();

            // Stream the response
            const response = await client.sendRequest(
                vsCodeLmMessages,
                { justification: `Cline would like to use '${client.name}' from '${client.vendor}'.\n\nClick 'Allow' to proceed.` },
                this.currentRequestCancellation.token
            );

            // Process stream chunks
            for await (const chunk of response.stream) {

                // Check for cancellation before processing each chunk
                if (this.currentRequestCancellation.token.isCancellationRequested) {

                    throw new vscode.CancellationError();
                }

                // Handle different chunk types
                if (chunk instanceof vscode.LanguageModelTextPart) {

                    contentBuilder.push(chunk.value);

                    yield {
                        type: "text",
                        text: chunk.value,
                    };
                }
            }

            // Count output tokens
            const outputTokens: number = await this.countTokens(
                contentBuilder.join('')
            );

            yield {
                type: "usage",
                inputTokens,
                outputTokens,
                totalCost: calculateApiCost(
                    model.info,
                    inputTokens,
                    outputTokens
                )
            };
        }
        catch (error) {

            this.releaseCurrentCancellation();

            if (error instanceof vscode.CancellationError) {

                throw new Error("Cline <Language Model API>: Request cancelled by user");
            }

            throw new Error(
                `Cline <Language Model API>: Response stream error: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    getModel(): { id: string; info: ModelInfo; } {

        if (!this.client) {

            return {
                id: (
                    this.options.vsCodeLmModelSelector
                        ? stringifyVsCodeLmModelSelector(
                            this.options.vsCodeLmModelSelector
                        )
                        : "vscode-lm"
                ),
                info: openAiModelInfoSaneDefaults
            };
        }

        // Generate model ID prioritizing explicit ID over vendor/family combination
        const modelParts: string[] = this.client.id
            ? [this.client.id]
            : [this.client.vendor, this.client.family].filter(Boolean);

        const modelId: string = modelParts.join(SELECTOR_SEPARATOR) || "vscode-lm-unknown";

        // Create model info with current limitations and capabilities
        const modelInfo: ModelInfo = {
            maxTokens: -1, // Current VSCode API limitation
            contextWindow: Math.max(0, this.client.maxInputTokens),
            supportsImages: false,
            supportsPromptCache: false,
            inputPrice: 0,  // Current VSCode API limitation
            outputPrice: 0, // Current VSCode API limitation
        };

        return { id: modelId, info: modelInfo };
    }
}
