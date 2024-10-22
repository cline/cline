import { Anthropic } from "@anthropic-ai/sdk";
import { UserContent } from "../cline/clineTypes";
import { findToolName } from "../../integrations/misc/export-markdown";
import * as vscode from "vscode";
import * as path from "path";
import os from "os";

export const cwd =
	vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop") // may or may not exist but fs checking existence would immediately ask for permission which would be bad UX, need to come up with a better solution
    
export class TaskHistoryManager {
    constructor(
    private existingApiConversationHistory: Anthropic.Messages.MessageParam[]
    ) {}

    processConversationHistory(): [Anthropic.Messages.MessageParam[], UserContent] {
    const conversationWithoutToolBlocks = this.removeToolBlocks();
    const [modifiedApiConversationHistory, modifiedOldUserContent] = this.processLastMessage(conversationWithoutToolBlocks);
    return [modifiedApiConversationHistory, modifiedOldUserContent];
    }

    private removeToolBlocks(): Anthropic.Messages.MessageParam[] {
    return this.existingApiConversationHistory.map((message) => {
        if (Array.isArray(message.content)) {
        const newContent = message.content.map((block) => {
            if (block.type === "tool_use") {
            const inputAsXml = Object.entries(block.input as Record<string, string>)
                .map(([key, value]) => `<${key}>\n${value}\n</${key}>`)
                .join("\n");
            return {
                type: "text",
                text: `<${block.name}>\n${inputAsXml}\n</${block.name}>`,
            } as Anthropic.Messages.TextBlockParam;
            } else if (block.type === "tool_result") {
            const contentAsTextBlocks = Array.isArray(block.content)
                ? block.content.filter((item) => item.type === "text")
                : [{ type: "text", text: block.content }];
            const textContent = contentAsTextBlocks.map((item) => item.text).join("\n\n");
            const toolName = findToolName(block.tool_use_id, this.existingApiConversationHistory);
            return {
                type: "text",
                text: `[${toolName} Result]\n\n${textContent}`,
            } as Anthropic.Messages.TextBlockParam;
            }
            return block;
        });
        return { ...message, content: newContent };
        }
        return message;
    });
    }

    private processLastMessage(conversationHistory: Anthropic.Messages.MessageParam[]): [Anthropic.Messages.MessageParam[], UserContent] {
    if (conversationHistory.length === 0) {
        throw new Error("Unexpected: No existing API conversation history");
    }

    const lastMessage = conversationHistory[conversationHistory.length - 1];

    if (lastMessage.role === "assistant") {
        return this.processAssistantLastMessage(conversationHistory, lastMessage);
    } else if (lastMessage.role === "user") {
        return this.processUserLastMessage(conversationHistory, lastMessage);
    } else {
        throw new Error("Unexpected: Last message is not a user or assistant message");
    }
    }

    private processAssistantLastMessage(
    conversationHistory: Anthropic.Messages.MessageParam[],
    lastMessage: Anthropic.Messages.MessageParam
    ): [Anthropic.Messages.MessageParam[], UserContent] {
    const content = Array.isArray(lastMessage.content)
        ? lastMessage.content
        : [{ type: "text", text: lastMessage.content }];
    const hasToolUse = content.some((block) => block.type === "tool_use");

    if (hasToolUse) {
        const toolUseBlocks = content.filter(
        (block) => block.type === "tool_use"
        ) as Anthropic.Messages.ToolUseBlock[];
        const toolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => ({
        type: "tool_result",
        tool_use_id: block.id,
        content: "Task was interrupted before this tool call could be completed.",
        }));
        return [conversationHistory, toolResponses];
    } else {
        return [conversationHistory, []];
    }
    }

    private processUserLastMessage(
    conversationHistory: Anthropic.Messages.MessageParam[],
    lastMessage: Anthropic.Messages.MessageParam
    ): [Anthropic.Messages.MessageParam[], UserContent] {
    const previousAssistantMessage: Anthropic.Messages.MessageParam | undefined =
        conversationHistory[conversationHistory.length - 2];

    const existingUserContent: UserContent = Array.isArray(lastMessage.content)
        ? lastMessage.content
        : [{ type: "text", text: lastMessage.content }];

    if (previousAssistantMessage && previousAssistantMessage.role === "assistant") {
        const assistantContent = Array.isArray(previousAssistantMessage.content)
        ? previousAssistantMessage.content
        : [{ type: "text", text: previousAssistantMessage.content }];

        const toolUseBlocks = assistantContent.filter(
        (block) => block.type === "tool_use"
        ) as Anthropic.Messages.ToolUseBlock[];

        if (toolUseBlocks.length > 0) {
        const existingToolResults = existingUserContent.filter(
            (block) => block.type === "tool_result"
        ) as Anthropic.ToolResultBlockParam[];

        const missingToolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks
            .filter(
            (toolUse) => !existingToolResults.some((result) => result.tool_use_id === toolUse.id)
            )
            .map((toolUse) => ({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Task was interrupted before this tool call could be completed.",
            }));

        return [conversationHistory.slice(0, -1), [...existingUserContent, ...missingToolResponses]];
        } else {
        return [conversationHistory.slice(0, -1), [...existingUserContent]];
        }
    } else {
        return [conversationHistory.slice(0, -1), [...existingUserContent]];
    }
    }
}

export function getTimeAgoText(timestamp?: number): string {
    if (!timestamp) return "just now"
    
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`
    if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
    return "just now"
}

export function getResumptionMessage(agoText: string, wasRecent: boolean, responseText?: string): string {
    let message = `[TASK RESUMPTION] This task was interrupted ${agoText}. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now '${cwd.toPosix()}'. If the task has not been completed, retry the last step before interruption and proceed with completing the task.\n\nNote: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry.`

    if (wasRecent) {
        message += "\n\nIMPORTANT: If the last tool use was a write_to_file that was interrupted, the file was reverted back to its original state before the interrupted edit, and you do NOT need to re-read the file as you already have its up-to-date contents."
    }

    if (responseText) {
        message += `\n\nNew instructions for task continuation:\n<user_message>\n${responseText}\n</user_message>`
    }

    return message
}