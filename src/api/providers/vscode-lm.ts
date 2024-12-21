import { Anthropic } from "@anthropic-ai/sdk";
import * as vscode from 'vscode';

import { ApiHandler } from "../";

import { calculateApiCost } from "../../utils/cost";

import { ApiStream } from "../transform/stream";
import { convertToVsCodeLmMessages } from "../transform/vscode-lm-format";

import { SELECTOR_SEPARATOR, stringifyVsCodeLmModelSelector } from "../../shared/vsCodeSelectorUtils";
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api";


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

/**
 * Handles interaction with VS Code's Language Model API for chat-based operations.
 * This handler implements the ApiHandler interface to provide VS Code LM specific functionality.
 * 
 * @implements {ApiHandler}
 * 
 * @remarks
 * The handler manages a VS Code language model chat client and provides methods to:
 * - Create and manage chat client instances
 * - Stream messages using VS Code's Language Model API
 * - Retrieve model information
 * 
 * @example
 * ```typescript
 * const options = {
 *   vsCodeLmModelSelector: { vendor: "copilot", family: "gpt-4" }
 * };
 * const handler = new VsCodeLmHandler(options);
 * 
 * // Stream a conversation
 * const systemPrompt = "You are a helpful assistant";
 * const messages = [{ role: "user", content: "Hello!" }];
 * for await (const chunk of handler.createMessage(systemPrompt, messages)) {
 *   console.log(chunk);
 * }
 * ```
 */
export class VsCodeLmHandler implements ApiHandler {

    private options: ApiHandlerOptions;
    private client: vscode.LanguageModelChat | null;
    private disposable: vscode.Disposable | null;
    private currentRequestCancellation: vscode.CancellationTokenSource | null;

    constructor(options: ApiHandlerOptions) {

        this.options = options;
        this.client = null;
        this.disposable = null;
        this.currentRequestCancellation = null;

        try {

            // Listen for model changes and reset client
            this.disposable = vscode.workspace.onDidChangeConfiguration(event => {

                if (event.affectsConfiguration('lm')) {

                    try {

                        this.client = null;
                        this.ensureCleanState();
                    }
                    catch (error) {

                        console.error('Error during configuration change cleanup:', error);
                    }
                }
            });
        }
        catch (error) {

            // Ensure cleanup if constructor fails
            this.dispose();

            throw new Error(
                `Cline <Language Model API>: Failed to initialize handler: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Creates a language model chat client based on the provided selector.
     *
     * @param selector - Selector criteria to filter language model chat instances
     * @returns Promise resolving to the first matching language model chat instance
     * @throws Error when no matching models are found with the given selector
     * 
     * @example
     * const selector = { vendor: "copilot", family: "gpt-4o" };
     * const chatClient = await createClient(selector);
     */
    async createClient(selector: vscode.LanguageModelChatSelector): Promise<vscode.LanguageModelChat> {

        const models: vscode.LanguageModelChat[] = await vscode.lm.selectChatModels(selector);

        if (models.length === 0) {

            throw new Error("Cline <Language Model API>: No models were found whilst using the specified selector.");
        }

        return models[0];
    }

    /**
     * Creates and streams a message using the VS Code Language Model API.
     *
     * @param systemPrompt - The system prompt to initialize the conversation context
     * @param messages - An array of message parameters following the Anthropic message format
     * 
     * @yields {ApiStream} An async generator that yields either text chunks or tool calls from the model response
     * 
     * @throws {Error} When vsCodeLmModelSelector option is not provided
     * @throws {Error} When the response stream encounters an error
     * 
     * @remarks
     * This method handles the initialization of the VS Code LM client if not already created,
     * converts the messages to VS Code LM format, and streams the response chunks.
     * Tool calls handling is currently a work in progress.
     */
    dispose(): void {

        if (this.disposable) {

            this.disposable.dispose();
        }

        if (this.currentRequestCancellation) {

            this.currentRequestCancellation.cancel();
            this.currentRequestCancellation.dispose();
        }
    }

    private async countTokens(text: string | vscode.LanguageModelChatMessage): Promise<number> {

        if (!this.client || !this.currentRequestCancellation) {

            return 0;
        }

        try {

            return await this.client.countTokens(text, this.currentRequestCancellation.token);
        }
        catch (error) {

            console.warn('Token counting failed:', error);
            return 0; // Fallback to prevent stream interruption
        }
    }

    private async calculateTotalInputTokens(systemPrompt: string, vsCodeLmMessages: vscode.LanguageModelChatMessage[]): Promise<number> {

        const systemTokens: number = await this.countTokens(systemPrompt);

        const messageTokens: number[] = await Promise.all(
            vsCodeLmMessages.map(msg => this.countTokens(msg))
        );

        return systemTokens + messageTokens.reduce(
            (sum: number, tokens: number): number => sum + tokens, 0
        );
    }

    private ensureCleanState(): void {

        if (this.currentRequestCancellation) {

            this.currentRequestCancellation.cancel();
            this.currentRequestCancellation.dispose();
            this.currentRequestCancellation = null;
        }
    }

    private async getClient(): Promise<vscode.LanguageModelChat> {

        if (!this.client) {

            if (!this.options.vsCodeLmModelSelector) {

                throw new Error(
                    "Cline <Language Model API>: The 'vsCodeLmModelSelector' option is required for the 'vscode-lm' provider."
                );
            }

            try {

                this.client = await this.createClient(this.options.vsCodeLmModelSelector);
            }
            catch (error) {

                throw new Error(
                    `Cline <Language Model API>: Failed to create client: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        }

        return this.client;
    }

    async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {

        // Ensure clean state before starting a new request
        this.ensureCleanState();
        const client: vscode.LanguageModelChat = await this.getClient();

        // Convert Anthropic messages to VS Code LM messages
        const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = [
            vscode.LanguageModelChatMessage.Assistant(systemPrompt),
            ...convertToVsCodeLmMessages(messages),
        ];

        // Initialize cancellation token for the request
        this.currentRequestCancellation = new vscode.CancellationTokenSource();

        // Calculate input tokens before starting the stream
        const totalInputTokens: number = await this.calculateTotalInputTokens(systemPrompt, vsCodeLmMessages);

        // Accumulate the text and count at the end of the stream to reduce token counting overhead.
        let accumulatedText: string = '';

        try {

            // Create the response stream
            const response: vscode.LanguageModelChatResponse = await client.sendRequest(
                vsCodeLmMessages,
                { justification: `Cline would like to use '${client.name}' from '${client.vendor}', Click 'Allow' to proceed.` },
                this.currentRequestCancellation.token
            );

            // Consume the stream and yield text chunks
            for await (const chunk of response.stream) {

                if (chunk instanceof vscode.LanguageModelTextPart) {

                    accumulatedText += chunk.value;

                    yield {
                        type: "text",
                        text: chunk.value,
                    };
                }
            }

            // Count tokens in the accumulated text after stream completion
            const totalOutputTokens: number = await this.countTokens(accumulatedText);

            // Report final usage after stream completion
            yield {
                type: "usage",
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                totalCost: calculateApiCost(
                    this.getModel().info,
                    totalInputTokens,
                    totalOutputTokens
                )
            };
        }
        catch (error: unknown) {

            this.ensureCleanState();

            if (error instanceof vscode.CancellationError) {

                throw new Error("Cline <Language Model API>: Request cancelled by user");
            }

            const errorMessage: string = error instanceof Error ? error.message : "Unknown error";
            throw new Error(`Cline <Language Model API>: Response stream error: ${errorMessage}`);
        }
    }

    // TODO: I'd really like to change this method signature to async so that this provider (and possibly others like it) can ensure the correct model data is returned.
    getModel(): { id: string; info: ModelInfo; } {

        if (this.client) {

            const modelId: string = (
                this.client.id || [this.client.vendor, this.client.family].filter(Boolean).join(SELECTOR_SEPARATOR)
            );

            return {
                id: modelId,
                info: {
                    maxTokens: -1,
                    contextWindow: Math.max(0, this.client.maxInputTokens),
                    supportsImages: false,
                    supportsPromptCache: true,
                    inputPrice: 0,
                    outputPrice: 0,
                },
            };
        }

        return {
            id: (
                this.options.vsCodeLmModelSelector
                    ? stringifyVsCodeLmModelSelector(this.options.vsCodeLmModelSelector)
                    : "vscode-lm"
            ),
            info: openAiModelInfoSaneDefaults,
        };
    }
}
