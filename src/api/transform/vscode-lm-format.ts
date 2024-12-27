import { Anthropic } from "@anthropic-ai/sdk";
import * as vscode from 'vscode';


/**
 * Safely converts a value into a plain object.
 * 
 * @param value - Any value to convert into an object
 * @returns A plain object representation of the input value
 * 
 * @remarks
 * This function handles several cases:
 * - If the input is null/undefined, returns an empty object
 * - If the input is a JSON string, parses it into an object
 * - If the input is already an object, creates a shallow copy
 * - For all other cases or errors, returns an empty object
 * 
 * @example
 * ```typescript
 * asObjectSafe(null) // returns {}
 * asObjectSafe('{"key": "value"}') // returns {key: "value"}
 * asObjectSafe({existing: "object"}) // returns {existing: "object"}
 * ```
 */
function asObjectSafe(value: any): object {

    // Handle null/undefined
    if (!value) {

        return {};
    }

    try {

        // Handle strings that might be JSON
        if (typeof value === 'string') {

            return JSON.parse(value);
        }

        // Handle pre-existing objects
        if (typeof value === 'object') {

            return Object.assign({}, value);
        }

        return {};
    }
    catch (error) {

        console.warn('Cline <Language Model API>: Failed to parse object:', error);
        return {};
    }
}

/**
 * Converts an array of Anthropic message parameters into VSCode Language Model chat messages.
 * 
 * This function handles both simple string content and complex message structures containing
 * text blocks, image blocks, tool uses, and tool results. It maintains the chronological
 * order of messages while transforming them into the VSCode Language Model format.
 * 
 * @param anthropicMessages - An array of Anthropic message parameters to be converted
 * @returns An array of converted {@link LanguageModelChatMessage} objects
 * 
 * @remarks
 * For user messages:
 * - Tool results are processed first to maintain correct ordering with tool use messages
 * - Images in tool results are handled with placeholder text
 * - Non-tool messages are processed after tool results
 * 
 * For assistant messages:
 * - Converts each non-tool message into individual text content blocks
 * - Processes tool use messages and attaches them as tool call parts
 * - Images are currently handled with a placeholder message block
 * 
 * @example
 * ```typescript
 * const anthropicMessages = [
 *   { role: "user", content: "Hello" },
 *   { role: "assistant", content: "Hi there" }
 * ];
 * const vsCodeMessages = convertToVsCodeLmMessages(anthropicMessages);
 * ```
 */
export function convertToVsCodeLmMessages(anthropicMessages: Anthropic.Messages.MessageParam[]): vscode.LanguageModelChatMessage[] {

    const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = [];

    for (const anthropicMessage of anthropicMessages) {

        // Handle simple string messages
        if (typeof anthropicMessage.content === "string") {

            vsCodeLmMessages.push(
                anthropicMessage.role === "assistant"
                    ? vscode.LanguageModelChatMessage.Assistant(anthropicMessage.content)
                    : vscode.LanguageModelChatMessage.User(anthropicMessage.content)
            );

            continue;
        }

        // Handle complex message structures
        switch (anthropicMessage.role) {

            case "user": {

                const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
                    nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[];
                    toolMessages: Anthropic.ToolResultBlockParam[];
                }>(
                    (acc, part) => {

                        if (part.type === "tool_result") {

                            acc.toolMessages.push(part);
                        }
                        else if (part.type === "text" || part.type === "image") {

                            acc.nonToolMessages.push(part);
                        }

                        // TODO: This information is from the openai provider, determine wether this is actually true.
                        // The user cannot send tool_use messages, so that case is not handled here.
                        return acc;
                    },
                    { nonToolMessages: [], toolMessages: [] },
                );

                // Process tool messages first since they must follow the tool use messages, 
                // then process non-tool messages after
                const contentParts = [

                    // Convert tool messages to ToolResultParts
                    ...toolMessages.map((toolMessage) => {

                        // Process tool result content into TextParts
                        const toolContentParts: vscode.LanguageModelTextPart[] = (

                            typeof toolMessage.content === "string"
                                ? [new vscode.LanguageModelTextPart(toolMessage.content)]
                                : (
                                    toolMessage.content?.map((part) => {

                                        if (part.type === "image") {
                                            
                                            return new vscode.LanguageModelTextPart(
                                                `[Image (${part.source?.type || 'Unknown source-type'}): ${part.source?.media_type || 'unknown media-type'} not supported by VSCode LM API]`
                                            );
                                        }
                                        return new vscode.LanguageModelTextPart(part.text);
                                    })
                                    ?? [new vscode.LanguageModelTextPart("")]
                                )
                        );

                        return new vscode.LanguageModelToolResultPart(
                            toolMessage.tool_use_id,
                            toolContentParts
                        );
                    }),

                    // Convert non-tool messages to TextParts after tool messages
                    ...nonToolMessages.map((part) => {

                        if (part.type === "image") {

                            // VSCode LM API currently does not support sending images in messages
                            return new vscode.LanguageModelTextPart(
                                `[Image (${part.source?.type || 'Unknown source-type'}): ${part.source?.media_type || 'unknown media-type'} not supported by VSCode LM API]`
                            );
                        }
                        return new vscode.LanguageModelTextPart(part.text);
                    })
                ];

                // Add single user message with all content parts
                vsCodeLmMessages.push(vscode.LanguageModelChatMessage.User(contentParts));
                break;
            }

            case "assistant": {

                const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
                    nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[];
                    toolMessages: Anthropic.ToolUseBlockParam[];
                }>(
                    (acc, part) => {

                        if (part.type === "tool_use") {

                            acc.toolMessages.push(part);
                        }
                        else if (part.type === "text" || part.type === "image") {

                            acc.nonToolMessages.push(part);
                        }

                        // TODO: This information is from the openai provider, determine wether this is actually true.
                        // The assistant cannot send tool_result messages, so that case is not handled here.

                        return acc;
                    },
                    { nonToolMessages: [], toolMessages: [] },
                );

                // Process tool messages first since they must follow the tool use messages, 
                // then process non-tool messages after
                const contentParts = [

                    // Convert tool messages to ToolCallParts first
                    ...toolMessages.map((toolMessage) =>
                        new vscode.LanguageModelToolCallPart(
                            toolMessage.id,
                            toolMessage.name,
                            asObjectSafe(toolMessage.input)
                        )
                    ),

                    // Convert non-tool messages to TextParts after tool messages
                    ...nonToolMessages.map((part) => {

                        if (part.type === "image") {

                            // VSCode LM API currently does not support image generation
                            return new vscode.LanguageModelTextPart("[Image generation not supported by VSCode LM API]");
                        }
                        
                        return new vscode.LanguageModelTextPart(part.text);
                    })
                ];

                // Add the assistant message to the list of messages
                vsCodeLmMessages.push(vscode.LanguageModelChatMessage.Assistant(contentParts));
                break;
            }
        }
    }

    return vsCodeLmMessages;
}

/**
 * Converts a VSCode Language Model chat message role to its corresponding Anthropic role string.
 * @param vsCodeLmMessageRole - The VSCode Language Model chat message role to convert
 * @returns The Anthropic role string ("assistant" or "user") if the role can be mapped, null otherwise
 */
export function convertToAnthropicRole(vsCodeLmMessageRole: vscode.LanguageModelChatMessageRole): string | null {

    switch (vsCodeLmMessageRole) {

        case vscode.LanguageModelChatMessageRole.Assistant:
            return "assistant";

        case vscode.LanguageModelChatMessageRole.User:
            return "user";

        default:
            return null;
    }
}

/**
 * Converts a VS Code Language Model chat message to an Anthropic message format.
 * 
 * @param vsCodeLmMessage - The VS Code Language Model chat message to convert
 * @returns An Anthropic message object conforming to the Anthropic.Messages.Message interface
 * @throws {Error} When the message role is not "assistant"
 * 
 * @remarks
 * This function performs the following transformations:
 * - Validates that the message is from an assistant role
 * - Generates a random UUID for the message ID
 * - Converts message content parts to Anthropic content blocks
 * - Sets default values for stop_reason and stop_sequence
 * - Initializes usage metrics (tokens) to 0
 */
export async function convertToAnthropicMessage(vsCodeLmMessage: vscode.LanguageModelChatMessage): Promise<Anthropic.Messages.Message> {

    const anthropicRole: string | null = convertToAnthropicRole(vsCodeLmMessage.role);
    if (anthropicRole !== "assistant") {

        throw new Error("Cline <Language Model API>: Only assistant messages are supported.");
    }

    return {
        id: crypto.randomUUID(),
        type: "message",
        model: "vscode-lm", // The actual model used to generate the message is not stored in the message.
        role: anthropicRole,
        content: (
            vsCodeLmMessage.content
                .map((part): Anthropic.ContentBlock | null => {

                    if (part instanceof vscode.LanguageModelTextPart) {

                        return {
                            type: "text",
                            text: part.value
                        };
                    }

                    if (part instanceof vscode.LanguageModelToolCallPart) {

                        return {
                            type: "tool_use",
                            id: part.callId || crypto.randomUUID(),
                            name: part.name,
                            input: asObjectSafe(part.input)
                        };
                    }

                    return null;
                })
                .filter(
                    (part): part is Anthropic.ContentBlock => part !== null
                )
        ),
        stop_reason: ((): null => null)(),
        stop_sequence: null,
        usage: {
            // TODO: Ideally the __tokenCount should be stored in the message history and retrieved from there.
            // However, this function currently isn't used anywhere at all, so this is a low priority.
            input_tokens: (vsCodeLmMessage as any).__tokenCount?.inputTokens || 0,
            output_tokens: (vsCodeLmMessage as any).__tokenCount?.outputTokens || 0
        }
    };
}
