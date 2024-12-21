import { Anthropic } from "@anthropic-ai/sdk";
import * as vscode from 'vscode';
import { ApiHandler } from "../";
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api";
import { ApiStream } from "../transform/stream";
import { convertToVsCodeLmMessages } from "../transform/vscode-lm-format";
import { calculateApiCost } from "../../utils/cost";


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

        // Listen for model changes and reset client
        this.disposable = vscode.workspace.onDidChangeConfiguration(event => {

            if (event.affectsConfiguration('lm')) {

                this.client = null;

                // Cancel any ongoing request when configuration changes
                if (this.currentRequestCancellation) {

                    this.currentRequestCancellation.cancel();
                    this.currentRequestCancellation.dispose();
                    this.currentRequestCancellation = null;
                }
            }
        });
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

    async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {

        // Cancel any ongoing request before starting a new one
        if (this.currentRequestCancellation) {

            this.currentRequestCancellation.cancel();
            this.currentRequestCancellation.dispose();
            this.currentRequestCancellation = null;
        }

        if (!this.client) {

            if (!this.options.vsCodeLmModelSelector) {

                throw new Error("Cline <Language Model API>: The 'vsCodeLmModelSelector' option is required for the 'vscode-lm' provider.");
            }

            this.client = await this.createClient(this.options.vsCodeLmModelSelector);
        }

        const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = [
            vscode.LanguageModelChatMessage.Assistant(systemPrompt),
            ...convertToVsCodeLmMessages(messages),
        ];

        this.currentRequestCancellation = new vscode.CancellationTokenSource();

        const response: vscode.LanguageModelChatResponse = await this.client.sendRequest(
            vsCodeLmMessages,
            { justification: `Cline would like to use '${this.client.name}', Click 'Allow' to proceed.` },
            this.currentRequestCancellation.token
        );

        try {

            let totalInputTokens: number = 0;
            let totalOutputTokens: number = 0;

            // Count input tokens first
            const systemTokens: number = await this.client.countTokens(systemPrompt, this.currentRequestCancellation.token);
            totalInputTokens += systemTokens;

            for (const message of vsCodeLmMessages) {
                
                const tokens: number = await this.client.countTokens(message, this.currentRequestCancellation.token);
                totalInputTokens += tokens;
            }

            // Stream text chunks without interrupting for usage reporting
            for await (const chunk of response.stream) {

                if (chunk instanceof vscode.LanguageModelTextPart) {

                    // Count tokens but don't yield usage yet
                    const chunkTokens: number = await this.client.countTokens(
                        chunk.value,
                        this.currentRequestCancellation.token
                    );

                    totalOutputTokens += chunkTokens;

                    yield {
                        type: "text",
                        text: chunk.value,
                    };
                }
            }

            // Report final usage once after all chunks are processed
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

            // Clean up cancellation token
            if (this.currentRequestCancellation) {

                this.currentRequestCancellation.dispose();
                this.currentRequestCancellation = null;
            }

            // Extract error details if available
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            const errorCode = error instanceof vscode.CancellationError ? "cancelled" : ((error as any)?.code || "unknown");
            throw new Error(`Cline <Language Model API>: Response stream error [${errorCode}]: ${errorMessage}`);
        }
    }

    stringifyVsCodeLmModelSelector(selector: vscode.LanguageModelChatSelector): string {

        if (!selector.vendor || !selector.family) {

            return selector.id || "";
        }

        return `${selector.vendor} / ${selector.family}`;
    }

    parseVsCodeLmModelSelector(stringifiedSelector: string): vscode.LanguageModelChatSelector {

        if (!stringifiedSelector.includes(" / ")) {

            return { id: stringifiedSelector };
        }

        const parts: string[] = stringifiedSelector.split(" / ");
        if (parts.length !== 2) {

            return { id: stringifiedSelector };
        }

        return { vendor: parts[0], family: parts[1] };
    }

    getModel(): { id: string; info: ModelInfo; } {

        console.log("GET MODEL CALLED!!!");

        if (this.client) {

            const modelId: string = this.client.id || `${this.client.vendor}/${this.client.family}`;

            return {
                id: modelId,
                info: {
                    maxTokens: this.client.maxInputTokens, // Use maxInputTokens as the practical limit
                    contextWindow: this.client.maxInputTokens,
                    supportsImages: false, // VSCode LM API currently doesn't support image inputs
                    supportsPromptCache: true, // VSCode LM API caches prompts internally
                    inputPrice: 0,
                    outputPrice: 0,
                },
            };
        }

        return {
            id: (
                this.options.vsCodeLmModelSelector
                    ? this.stringifyVsCodeLmModelSelector(this.options.vsCodeLmModelSelector)
                    : ""
            ),
            info: openAiModelInfoSaneDefaults,
        };
    }
}
