import { Anthropic } from "@anthropic-ai/sdk"
import * as fs from "fs/promises"
import * as path from "path"
import { ClineBase } from "./ClineBase"
import { fileExistsAtPath } from "../utils/fs"
import { findLastIndex } from "../shared/array"
import { formatResponse } from "./prompts/responses"
import { ClineMessage } from "../shared/ExtensionMessage"
import { formatContentBlockToMarkdown } from "../integrations/misc/export-markdown"
import { getApiMetrics } from "../shared/getApiMetrics"
import { combineApiRequests } from "../shared/combineApiRequests"
import { combineCommandSequences } from "../shared/combineCommandSequences"
import { GlobalFileNames } from "./webview/task/GlobalFileNames"

type UserContent = Array<
    Anthropic.TextBlockParam | 
    Anthropic.ImageBlockParam | 
    Anthropic.ToolUseBlockParam | 
    Anthropic.ToolResultBlockParam
>

export class ClineTask extends ClineBase {
    protected async ensureTaskDirectoryExists(): Promise<string> {
        const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
        if (!globalStoragePath) {
            throw new Error("Global storage uri is invalid")
        }
        const taskDir = path.join(globalStoragePath, "tasks", this.taskId)
        await fs.mkdir(taskDir, { recursive: true })
        return taskDir
    }

    protected async getSavedApiConversationHistory(): Promise<Anthropic.MessageParam[]> {
        const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.apiConversationHistory)
        const fileExists = await fileExistsAtPath(filePath)
        if (fileExists) {
            return JSON.parse(await fs.readFile(filePath, "utf8"))
        }
        return []
    }

    protected async addToApiConversationHistory(message: Anthropic.MessageParam) {
        this.apiConversationHistory.push(message)
        await this.saveApiConversationHistory()
    }

    protected async overwriteApiConversationHistory(newHistory: Anthropic.MessageParam[]) {
        this.apiConversationHistory = newHistory
        await this.saveApiConversationHistory()
    }

    protected async saveApiConversationHistory() {
        try {
            const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.apiConversationHistory)
            await fs.writeFile(filePath, JSON.stringify(this.apiConversationHistory))
        } catch (error) {
            console.error("Failed to save API conversation history:", error)
        }
    }

    protected async getSavedClineMessages(): Promise<ClineMessage[]> {
        const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.uiMessages)
        if (await fileExistsAtPath(filePath)) {
            return JSON.parse(await fs.readFile(filePath, "utf8"))
        } else {
            const oldPath = path.join(await this.ensureTaskDirectoryExists(), "claude_messages.json")
            if (await fileExistsAtPath(oldPath)) {
                const data = JSON.parse(await fs.readFile(oldPath, "utf8"))
                await fs.unlink(oldPath)
                return data
            }
        }
        return []
    }

    protected async addToClineMessages(message: ClineMessage) {
        this.clineMessages.push(message)
        await this.saveClineMessages()
    }

    protected async overwriteClineMessages(newMessages: ClineMessage[]) {
        this.clineMessages = newMessages
        await this.saveClineMessages()
    }

    protected async saveClineMessages() {
        try {
            const filePath = path.join(await this.ensureTaskDirectoryExists(), GlobalFileNames.uiMessages)
            await fs.writeFile(filePath, JSON.stringify(this.clineMessages))
            const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(this.clineMessages.slice(1))))
            const taskMessage = this.clineMessages[0]
            const lastRelevantMessage = this.clineMessages[
                findLastIndex(
                    this.clineMessages,
                    (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
                )
            ]
            await this.providerRef.deref()?.updateTaskHistory({
                id: this.taskId,
                ts: lastRelevantMessage.ts,
                task: taskMessage.text ?? "",
                tokensIn: apiMetrics.totalTokensIn,
                tokensOut: apiMetrics.totalTokensOut,
                cacheWrites: apiMetrics.totalCacheWrites,
                cacheReads: apiMetrics.totalCacheReads,
                totalCost: apiMetrics.totalCost,
            })
        } catch (error) {
            console.error("Failed to save cline messages:", error)
        }
    }

    protected async startTask(task?: string, images?: string[]): Promise<void> {
        this.clineMessages = []
        this.apiConversationHistory = []
        await this.providerRef.deref()?.postStateToWebview()

        await this.say("text", task, images)

        let imageBlocks: Anthropic.ImageBlockParam[] = formatResponse.imageBlocks(images)
        await this.initiateTaskLoop([
            {
                type: "text",
                text: `<task>\n${task}\n</task>`,
            },
            ...imageBlocks,
        ])
    }

    protected async resumeTaskFromHistory() {
        const modifiedClineMessages = await this.getSavedClineMessages()

        const lastRelevantMessageIndex = findLastIndex(
            modifiedClineMessages,
            (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
        )
        if (lastRelevantMessageIndex !== -1) {
            modifiedClineMessages.splice(lastRelevantMessageIndex + 1)
        }

        const lastApiReqStartedIndex = findLastIndex(
            modifiedClineMessages,
            (m) => m.type === "say" && m.say === "api_req_started",
        )
        if (lastApiReqStartedIndex !== -1) {
            const lastApiReqStarted = modifiedClineMessages[lastApiReqStartedIndex]
            const { cost, cancelReason } = JSON.parse(lastApiReqStarted.text || "{}")
            if (cost === undefined && cancelReason === undefined) {
                modifiedClineMessages.splice(lastApiReqStartedIndex, 1)
            }
        }

        await this.overwriteClineMessages(modifiedClineMessages)
        this.clineMessages = await this.getSavedClineMessages()

        const lastClineMessage = this.clineMessages
            .slice()
            .reverse()
            .find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))

        let askType = lastClineMessage?.ask === "completion_result" ? "resume_completed_task" : "resume_task"

        const { response, text, images } = await this.ask(askType)
        let responseText: string | undefined
        let responseImages: string[] | undefined
        if (response === "messageResponse") {
            await this.say("user_feedback", text, images)
            responseText = text
            responseImages = images
        }

        let existingApiConversationHistory = await this.getSavedApiConversationHistory()

        // Convert tool blocks to text format for compatibility
        const conversationWithoutToolBlocks = existingApiConversationHistory.map((message) => {
            if (Array.isArray(message.content)) {
                const newContent = message.content.map((block) => {
                    if (block.type === "tool_use") {
                        const inputAsXml = Object.entries(block.input as Record<string, string>)
                            .map(([key, value]) => `<${key}>\n${value}\n</${key}>`)
                            .join("\n")
                        return {
                            type: "text",
                            text: `<${block.name}>\n${inputAsXml}\n</${block.name}>`,
                        } as Anthropic.Messages.TextBlockParam
                    } else if (block.type === "tool_result") {
                        const contentAsTextBlocks = Array.isArray(block.content)
                            ? block.content.filter((item) => item.type === "text")
                            : [{ type: "text", text: block.content }]
                        const textContent = contentAsTextBlocks.map((item) => item.text).join("\n\n")
                        return {
                            type: "text",
                            text: `[Tool Result]\n\n${textContent}`,
                        } as Anthropic.Messages.TextBlockParam
                    }
                    return block
                })
                return { ...message, content: newContent }
            }
            return message
        })
        existingApiConversationHistory = conversationWithoutToolBlocks

        let newUserContent: UserContent = []

        const agoText = (() => {
            const timestamp = lastClineMessage?.ts ?? Date.now()
            const now = Date.now()
            const diff = now - timestamp
            const minutes = Math.floor(diff / 60000)
            const hours = Math.floor(minutes / 60)
            const days = Math.floor(hours / 24)

            if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`
            if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`
            if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
            return "just now"
        })()

        const wasRecent = lastClineMessage?.ts && Date.now() - lastClineMessage.ts < 30_000

        newUserContent.push({
            type: "text",
            text: `[TASK RESUMPTION] This task was interrupted ${agoText}. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. If the task has not been completed, retry the last step before interruption and proceed with completing the task.\n\nNote: If you previously attempted a tool use that the user did not provide a result for, you should assume the tool use was not successful and assess whether you should retry. If the last tool was a browser_action, the browser has been closed and you must launch a new browser if needed.${
                wasRecent
                    ? "\n\nIMPORTANT: If the last tool use was a write_to_file that was interrupted, the file was reverted back to its original state before the interrupted edit, and you do NOT need to re-read the file as you already have its up-to-date contents."
                    : ""
            }` +
                (responseText
                    ? `\n\nNew instructions for task continuation:\n<user_message>\n${responseText}\n</user_message>`
                    : ""),
        })

        if (responseImages && responseImages.length > 0) {
            newUserContent.push(...formatResponse.imageBlocks(responseImages))
        }

        await this.overwriteApiConversationHistory(existingApiConversationHistory)
        await this.initiateTaskLoop(newUserContent)
    }

    private async initiateTaskLoop(userContent: UserContent): Promise<void> {
        let nextUserContent = userContent
        let includeFileDetails = true
        while (!this.abort) {
            const didEndLoop = await this.recursivelyMakeClineRequests(nextUserContent, includeFileDetails)
            includeFileDetails = false

            if (didEndLoop) {
                break
            } else {
                nextUserContent = [
                    {
                        type: "text",
                        text: formatResponse.noToolsUsed(),
                    },
                ]
                this.consecutiveMistakeCount++
            }
        }
    }

    protected async say(type: any, text?: string, images?: string[], partial?: boolean): Promise<void> {
        throw new Error("Method not implemented.")
    }

    protected async ask(type: any, text?: string, partial?: boolean): Promise<any> {
        throw new Error("Method not implemented.")
    }

    protected async recursivelyMakeClineRequests(userContent: UserContent, includeFileDetails: boolean): Promise<boolean> {
        throw new Error("Method not implemented.")
    }
}
