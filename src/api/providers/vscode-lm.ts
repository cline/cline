import { Anthropic } from "@anthropic-ai/sdk";
import * as vscode from 'vscode';
import { ApiHandler } from "../";
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api";
import { ApiStream } from "../transform/stream";
import { convertToVsCodeLmMessages } from "../transform/vscode-lm-format";


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

    // TODO: Listen for the onDidChangeChatModels event, then wipe the client.
    // See the documentation of the function "lm.selectChatModels"
    private client: vscode.LanguageModelChat | null;

    constructor(options: ApiHandlerOptions) {

        this.options = options;
        this.client = null;
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
    async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {

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

        const response: vscode.LanguageModelChatResponse = await this.client.sendRequest(
            vsCodeLmMessages,
            { justification: `Cline would like to use '${this.client.name}', Click 'Allow' to proceed.` },
            new vscode.CancellationTokenSource().token
        );

        try {

            for await (const chunk of response.stream) {

                if (chunk instanceof vscode.LanguageModelTextPart) {

                    yield {
                        type: "text",
                        text: chunk.value,
                    };
                }

                if (chunk instanceof vscode.LanguageModelToolCallPart) {

                    // TODO: Determine how to handle tool calls.
                }
            }
        }
        catch (error) {

            // TODO: Check if the error has any form of error code or message that can be used to determine the cause of the error.
            throw new Error("Cline <Language Model API>: Response stream has returned an error.");
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

    /**
     * Retrieves the model information for the current language model client.
     * 
     * @throws {Error} When the client has not been initialized.
     * @returns {Object} An object containing:
     *   - id: The unique identifier of the model client
     *   - info: ModelInfo object containing:
     *     - maxTokens: Maximum number of tokens supported (-1 if undefined)
     *     - contextWindow: Maximum number of input tokens supported
     *     - supportsImages: Whether the model supports image inputs
     *     - supportsPromptCache: Whether the model supports prompt caching
     *     - inputPrice: Cost per input token
     *     - outputPrice: Cost per output token
     * @remarks
     * // TODO: This method should be fixed to return the correct model information 100% of the time.
     */
    getModel(): { id: string; info: ModelInfo; } {

        if (this.client) {

            return {
                id: this.client.id || "",
                info: {
                    maxTokens: -1, // TODO: Check if this is relevant because of sliding windows, etc. Maybe check if the model supports this and use the contextWindow as a default/fallback.
                    contextWindow: this.client.maxInputTokens,
                    supportsImages: false, // TODO: Find a way to determine this...
                    supportsPromptCache: false, // TODO: Find a way to determine this...
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
