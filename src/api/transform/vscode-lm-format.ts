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

        // TODO: Maybe log this somewhere?

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
 * - Combines non-tool messages into a single text content
 * - Processes tool use messages and attaches them to the assistant message
 * - Images are currently handled with a placeholder
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

        if (typeof anthropicMessage.content === "string") {

            vsCodeLmMessages.push(
                anthropicMessage.role === "assistant"
                    ? vscode.LanguageModelChatMessage.Assistant(anthropicMessage.content)
                    : vscode.LanguageModelChatMessage.User(anthropicMessage.content)
            );

            continue;
        }

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

                        // The user cannot send tool_use messages, so that case is not handled here.

                        return acc;
                    },
                    { nonToolMessages: [], toolMessages: [] },
                );

                // Process tool result messages FIRST since they must follow the tool use messages
                let toolResultImages: Anthropic.Messages.ImageBlockParam[] = [];

                toolMessages.forEach((toolMessage) => {

                    // The Anthropic SDK allows tool results to be a string or an array of text and image blocks, enabling rich and structured content. In contrast, the OpenAI SDK only supports tool results as a single string, so we map the Anthropic tool result parts into one concatenated string to maintain compatibility.
                    let content: string;

                    if (typeof toolMessage.content === "string") {

                        content = toolMessage.content;
                    }
                    else {

                        content = toolMessage.content
                            ?.map((part) => {

                                if (part.type === "image") {

                                    toolResultImages.push(part);
                                    return "(see following user message for image)";
                                }

                                return part.text;
                            })
                            .join("\n") ?? "";
                    }

                    vsCodeLmMessages.push(
                        vscode.LanguageModelChatMessage.User([
                            new vscode.LanguageModelToolResultPart(toolMessage.tool_use_id, [
                                new vscode.LanguageModelTextPart(content)
                            ])
                        ])
                    );
                });

                // Process non-tool messages
                if (nonToolMessages.length > 0) {

                    const messages: vscode.LanguageModelChatMessage[] = nonToolMessages.map((part) => {

                        if (part.type === "image") {

                            // TODO: Determine wether it is possible to send images as part of the user message.

                            toolResultImages.push(part);
                            return vscode.LanguageModelChatMessage.User("(see following user message for image)");
                        }

                        return vscode.LanguageModelChatMessage.User(part.text);
                    });

                    vsCodeLmMessages.push(...messages);
                }

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

                        // The assistant cannot send tool_result messages, so that case is not handled here.

                        return acc;
                    },
                    { nonToolMessages: [], toolMessages: [] },
                );

                // Process non-tool messages
                let content: string | undefined;

                if (nonToolMessages.length > 0) {

                    content = nonToolMessages
                        .map((part) => {

                            if (part.type === "image") {

                                // TODO: Determine wether it is possible to send images as part of the assistant message.
                                return "<IMAGE PLACEHOLDER>";
                            }

                            return part.text;
                        })
                        .join("\n");
                }

                vsCodeLmMessages.push(
                    vscode.LanguageModelChatMessage.Assistant([
                        new vscode.LanguageModelTextPart(content || ""),
                        ...(
                            toolMessages.map(
                                (toolMessage) => new vscode.LanguageModelToolCallPart(
                                    toolMessage.id,
                                    toolMessage.name,
                                    asObjectSafe(toolMessage.input)
                                )
                            )
                        ),
                    ])
                );

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
 * 
 * Currently handles:
 * - Text content (LanguageModelTextPart)
 * - Tool calls (LanguageModelToolCallPart)
 * 
 * Note: Tool results (LanguageModelToolResultPart) handling is not yet implemented.
 */
export function convertToAnthropicMessage(vsCodeLmMessage: vscode.LanguageModelChatMessage): Anthropic.Messages.Message {

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

                    // TODO: Determine how to handle tool results, if necessary.
                    // if (part instanceof LanguageModelToolResultPart) {}

                    return null;
                })
                .filter(
                    (part): part is Anthropic.ContentBlock => part !== null
                )
        ),
        stop_reason: (() => { return null; })(), // The stop reason is not stored in the message.
        stop_sequence: null, // which custom stop_sequence was generated, if any (not applicable if you don't use stop_sequence)
        usage: {
            input_tokens: 0, // TODO: Calculate the number of tokens used in the input for display purposes in the Cline UI.
            output_tokens: 0, // TODO: Calculate the number of tokens used in the input for display purposes in the Cline UI.
        }
    };
}
