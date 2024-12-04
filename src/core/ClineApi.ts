import { Anthropic } from "@anthropic-ai/sdk"
import { ClineWebview } from "./ClineWebview"
import { findLastIndex } from "../shared/array"
import { SYSTEM_PROMPT } from "./prompts/system"
import { addCustomInstructions } from "./prompts/system"
import { ApiStream } from "../api/transform/stream"
import { serializeError } from "serialize-error"
import { parseAssistantMessage } from "./assistant-message"
import { formatResponse } from "./prompts/responses"
import { parseMentions } from "./mentions"
import { truncateHalfConversation } from "./sliding-window"
import { ClineApiReqCancelReason, ClineApiReqInfo } from "../shared/ExtensionMessage"
import { formatContentBlockToMarkdown } from "../integrations/misc/export-markdown"
import delay from "delay"
import pWaitFor from "p-wait-for"
import cloneDeep from "clone-deep"
import * as vscode from "vscode"
import * as path from "path"
import * as os from "os"
import { listFiles } from "../services/glob/list-files"
import { arePathsEqual } from "../utils/path"

type UserContent = Array<
    Anthropic.TextBlockParam | 
    Anthropic.ImageBlockParam | 
    Anthropic.ToolUseBlockParam | 
    Anthropic.ToolResultBlockParam
>

export class ClineApi extends ClineWebview {
    // Streaming state
    private currentStreamingContentIndex = 0
    private assistantMessageContent: any[] = []
    private presentAssistantMessageLocked = false
    private presentAssistantMessageHasPendingUpdates = false
    private userMessageContent: UserContent = []
    private userMessageContentReady = false
    private didRejectTool = false
    private didAlreadyUseTool = false
    private didCompleteReadingStream = false

    protected async presentAssistantMessage(): Promise<void> {
        if (this.abort) {
            throw new Error("Cline instance aborted")
        }

        if (this.presentAssistantMessageLocked) {
            this.presentAssistantMessageHasPendingUpdates = true
            return
        }
        this.presentAssistantMessageLocked = true
        this.presentAssistantMessageHasPendingUpdates = false

        if (this.currentStreamingContentIndex >= this.assistantMessageContent.length) {
            if (this.didCompleteReadingStream) {
                this.userMessageContentReady = true
            }
            this.presentAssistantMessageLocked = false
            return
        }

        const block = cloneDeep(this.assistantMessageContent[this.currentStreamingContentIndex])

        // Handle the block based on its type
        // This is a placeholder - the actual implementation would handle different types of blocks
        if (block.type === "text") {
            await this.say("text", block.content, undefined, block.partial)
        }

        this.presentAssistantMessageLocked = false
        
        if (this.presentAssistantMessageHasPendingUpdates) {
            await this.presentAssistantMessage()
        }
    }

    protected async getEnvironmentDetails(includeFileDetails: boolean = false): Promise<string> {
        let details = ""

        details += "\n\n# VSCode Visible Files"
        const visibleFiles = vscode.window.visibleTextEditors
            ?.map((editor) => editor.document?.uri?.fsPath)
            .filter(Boolean)
            .map((absolutePath) => path.relative(this.cwd, absolutePath).toPosix())
            .join("\n")
        if (visibleFiles) {
            details += `\n${visibleFiles}`
        } else {
            details += "\n(No visible files)"
        }

        details += "\n\n# VSCode Open Tabs"
        const openTabs = vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .map((tab) => (tab.input as vscode.TabInputText)?.uri?.fsPath)
            .filter(Boolean)
            .map((absolutePath) => path.relative(this.cwd, absolutePath).toPosix())
            .join("\n")
        if (openTabs) {
            details += `\n${openTabs}`
        } else {
            details += "\n(No open tabs)"
        }

        const busyTerminals = this.terminalManager.getTerminals(true)
        const inactiveTerminals = this.terminalManager.getTerminals(false)

        if (busyTerminals.length > 0 && this.didEditFile) {
            await delay(300)
        }

        if (busyTerminals.length > 0) {
            await pWaitFor(() => busyTerminals.every((t) => !this.terminalManager.isProcessHot(t.id)), {
                interval: 100,
                timeout: 15_000,
            }).catch(() => {})
        }

        let terminalDetails = ""
        if (busyTerminals.length > 0) {
            terminalDetails += "\n\n# Actively Running Terminals"
            for (const busyTerminal of busyTerminals) {
                terminalDetails += `\n## Original command: \`${busyTerminal.lastCommand}\``
                const newOutput = this.terminalManager.getUnretrievedOutput(busyTerminal.id)
                if (newOutput) {
                    terminalDetails += `\n### New Output\n${newOutput}`
                }
            }
        }

        if (inactiveTerminals.length > 0) {
            const inactiveTerminalOutputs = new Map<number, string>()
            for (const inactiveTerminal of inactiveTerminals) {
                const newOutput = this.terminalManager.getUnretrievedOutput(inactiveTerminal.id)
                if (newOutput) {
                    inactiveTerminalOutputs.set(inactiveTerminal.id, newOutput)
                }
            }
            if (inactiveTerminalOutputs.size > 0) {
                terminalDetails += "\n\n# Inactive Terminals"
                for (const [terminalId, newOutput] of inactiveTerminalOutputs) {
                    const inactiveTerminal = inactiveTerminals.find((t) => t.id === terminalId)
                    if (inactiveTerminal) {
                        terminalDetails += `\n## ${inactiveTerminal.lastCommand}`
                        terminalDetails += `\n### New Output\n${newOutput}`
                    }
                }
            }
        }

        if (terminalDetails) {
            details += terminalDetails
        }

        if (includeFileDetails) {
            details += `\n\n# Current Working Directory (${this.cwd.toPosix()}) Files\n`
            const isDesktop = arePathsEqual(this.cwd, path.join(os.homedir(), "Desktop"))
            if (isDesktop) {
                details += "(Desktop files not shown automatically. Use list_files to explore if needed.)"
            } else {
                const [files, didHitLimit] = await listFiles(this.cwd, true, 200)
                const result = formatResponse.formatFilesList(this.cwd, files, didHitLimit)
                details += result
            }
        }

        return `<environment_details>\n${details.trim()}\n</environment_details>`
    }

    private async *attemptApiRequest(previousApiReqIndex: number): AsyncGenerator<any, void, unknown> {
        let systemPrompt = await SYSTEM_PROMPT(this.cwd, this.api.getModel().info.supportsComputerUse ?? false)
        if (this.customInstructions && this.customInstructions.trim()) {
            systemPrompt += addCustomInstructions(this.customInstructions)
        }

        if (previousApiReqIndex >= 0) {
            const previousRequest = this.clineMessages[previousApiReqIndex]
            if (previousRequest && previousRequest.text) {
                const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(
                    previousRequest.text,
                )
                const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
                const contextWindow = this.api.getModel().info.contextWindow || 128_000
                const maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8)
                if (totalTokens >= maxAllowedSize) {
                    const truncatedMessages = truncateHalfConversation(this.apiConversationHistory)
                    await this.overwriteApiConversationHistory(truncatedMessages)
                }
            }
        }

        const stream = this.api.createMessage(systemPrompt, this.apiConversationHistory)
        const iterator = stream[Symbol.asyncIterator]()

        try {
            const firstChunk = await iterator.next()
            yield firstChunk.value
        } catch (error) {
            const { response } = await this.ask(
                "api_req_failed",
                error.message ?? JSON.stringify(serializeError(error), null, 2),
            )
            if (response !== "yesButtonClicked") {
                throw new Error("API request failed")
            }
            await this.say("api_req_retried")
            yield* this.attemptApiRequest(previousApiReqIndex)
            return
        }

        yield* iterator
    }

    private async loadContext(userContent: UserContent, includeFileDetails: boolean = false) {
        return await Promise.all([
            Promise.all(
                userContent.map(async (block) => {
                    if (block.type === "text") {
                        return {
                            ...block,
                            text: await parseMentions(block.text, this.cwd, this.urlContentFetcher),
                        }
                    } else if (block.type === "tool_result") {
                        const isUserMessage = (text: string) =>
                            text.includes("<feedback>") || text.includes("<answer>")
                        if (typeof block.content === "string" && isUserMessage(block.content)) {
                            return {
                                ...block,
                                content: await parseMentions(block.content, this.cwd, this.urlContentFetcher),
                            }
                        } else if (Array.isArray(block.content)) {
                            const parsedContent = await Promise.all(
                                block.content.map(async (contentBlock) => {
                                    if (contentBlock.type === "text" && isUserMessage(contentBlock.text)) {
                                        return {
                                            ...contentBlock,
                                            text: await parseMentions(
                                                contentBlock.text,
                                                this.cwd,
                                                this.urlContentFetcher,
                                            ),
                                        }
                                    }
                                    return contentBlock
                                }),
                            )
                            return {
                                ...block,
                                content: parsedContent,
                            }
                        }
                    }
                    return block
                }),
            ),
            this.getEnvironmentDetails(includeFileDetails),
        ])
    }
}
