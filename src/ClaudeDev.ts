// ClaudeDev.ts
import { Anthropic } from "@anthropic-ai/sdk"
import { ResultPromise } from "execa"
import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"
import treeKill from "tree-kill"
import * as vscode from "vscode"
import { ApiHandler, buildApiHandler } from "./api"
import { ClaudeDevProvider } from "./providers/ClaudeDevProvider"
import { ApiConfiguration } from "./shared/api"
import { ClaudeRequestResult } from "./shared/ClaudeRequestResult"
import { DEFAULT_MAX_REQUESTS_PER_TASK } from "./shared/Constants"
import { ClaudeAsk, ClaudeMessage, ClaudeSay } from "./shared/ExtensionMessage"
import { HistoryItem } from "./shared/HistoryItem"
import { ToolName } from "./shared/Tool"
import { ClaudeAskResponse } from "./shared/WebviewMessage"
import { FileOperationsImpl } from "./core/FileOperations"
import { ApiOperationsImpl } from "./core/ApiOperations"
import { ToolExecutionsImpl } from "./core/ToolExecutions"
import { UserContent } from "./shared/UserContent"
import { ToolResponse } from "./shared/ToolResponse"
import { ClaudeDevCore } from "./shared/ClaudeDevCore"
import { FileOperations } from "./shared/FileOperations"
import { ApiOperations } from "./shared/ApiOperations"
import { ToolExecutions } from "./shared/ToolExecutions"
import { findLastIndex } from "./utils"
import { getApiMetrics } from "./shared/getApiMetrics"
import { combineApiRequests } from "./shared/combineApiRequests"
import { combineCommandSequences } from "./shared/combineCommandSequences"

export const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop")


export class ClaudeDev implements ClaudeDevCore {
  readonly taskId: string
  api: ApiHandler
  maxRequestsPerTask: number
  customInstructions?: string
  alwaysAllowReadOnly: boolean
  requestCount = 0
  apiConversationHistory: Anthropic.MessageParam[] = []
  claudeMessages: ClaudeMessage[] = []
  private askResponse?: ClaudeAskResponse
  private askResponseText?: string
  private askResponseImages?: string[]
  private lastMessageTs?: number
  executeCommandRunningProcess?: ResultPromise
  shouldSkipNextApiReqStartedMessage = false
  private providerRef: WeakRef<ClaudeDevProvider>
  abort: boolean = false
  cwd: string = cwd

  private fileOperations: FileOperations
  private apiOperations: ApiOperations
  private toolExecutions: ToolExecutions

  constructor(
    provider: ClaudeDevProvider,
    apiConfiguration: ApiConfiguration,
    maxRequestsPerTask?: number,
    customInstructions?: string,
    alwaysAllowReadOnly?: boolean,
    task?: string,
    images?: string[],
    historyItem?: HistoryItem
  ) {
    this.providerRef = new WeakRef(provider)
    this.api = buildApiHandler(apiConfiguration)
    this.maxRequestsPerTask = maxRequestsPerTask ?? DEFAULT_MAX_REQUESTS_PER_TASK
    this.customInstructions = customInstructions
    this.alwaysAllowReadOnly = alwaysAllowReadOnly ?? false

    this.fileOperations = new FileOperationsImpl(this)
    this.apiOperations = new ApiOperationsImpl(this)
    this.toolExecutions = new ToolExecutionsImpl(this)

    if (historyItem) {
      this.taskId = historyItem.id
      this.resumeTaskFromHistory()
    } else if (task || images) {
      this.taskId = Date.now().toString()
      this.startTask(task, images)
    } else {
      throw new Error("Either historyItem or task/images must be provided")
    }
  }

  updateApi(apiConfiguration: ApiConfiguration) {
    this.api = buildApiHandler(apiConfiguration)
  }

  updateMaxRequestsPerTask(maxRequestsPerTask: number | undefined) {
    this.maxRequestsPerTask = maxRequestsPerTask ?? DEFAULT_MAX_REQUESTS_PER_TASK
  }

  updateCustomInstructions(customInstructions: string | undefined) {
    this.customInstructions = customInstructions
  }

  updateAlwaysAllowReadOnly(alwaysAllowReadOnly: boolean | undefined) {
    this.alwaysAllowReadOnly = alwaysAllowReadOnly ?? false
  }

  async handleWebviewAskResponse(askResponse: ClaudeAskResponse, text?: string, images?: string[]) {
    this.askResponse = askResponse
    this.askResponseText = text
    this.askResponseImages = images
  }

  async ask(
    type: ClaudeAsk,
    question?: string
  ): Promise<{ response: ClaudeAskResponse; text?: string; images?: string[] }> {
    if (this.abort) {
      throw new Error("ClaudeDev instance aborted")
    }
    this.askResponse = undefined
    this.askResponseText = undefined
    this.askResponseImages = undefined
    const askTs = Date.now()
    this.lastMessageTs = askTs
    await this.addToClaudeMessages({ ts: askTs, type: "ask", ask: type, text: question })
    await this.providerRef.deref()?.postStateToWebview()
    await new Promise<void>((resolve) => {
      const checkResponse = () => {
        if (this.askResponse !== undefined || this.lastMessageTs !== askTs) {
          resolve()
        } else {
          setTimeout(checkResponse, 100)
        }
      }
      checkResponse()
    })
    if (this.lastMessageTs !== askTs) {
      throw new Error("Current ask promise was ignored")
    }
    const result = { response: this.askResponse!, text: this.askResponseText, images: this.askResponseImages }
    this.askResponse = undefined
    this.askResponseText = undefined
    this.askResponseImages = undefined
    return result
  }

  async say(type: ClaudeSay, text?: string, images?: string[]): Promise<undefined> {
    if (this.abort) {
      throw new Error("ClaudeDev instance aborted")
    }
    const sayTs = Date.now()
    this.lastMessageTs = sayTs
    await this.addToClaudeMessages({ ts: sayTs, type: "say", say: type, text: text, images })
    await this.providerRef.deref()?.postStateToWebview()
    return undefined
  }

  private async startTask(task?: string, images?: string[]): Promise<void> {
    this.claudeMessages = []
    this.apiConversationHistory = []
    await this.providerRef.deref()?.postStateToWebview()

    await this.say("text", task, images)

    const taskText = `<task>\n${task}\n</task>`
    let imageBlocks: Anthropic.ImageBlockParam[] = this.formatImagesIntoBlocks(images)
    await this.say(
      "api_req_started",
      JSON.stringify({
        request: this.api.createUserReadableRequest([
          {
            type: "text",
            text: `${taskText}\n\n<potentially_relevant_details>(see getPotentiallyRelevantDetails in src/ClaudeDev.ts)</potentially_relevant_details>`,
          },
          ...imageBlocks,
        ]),
      })
    )
    this.shouldSkipNextApiReqStartedMessage = true
    this.getPotentiallyRelevantDetails(true).then(async (verboseDetails) => {
      await this.initiateTaskLoop([
        {
          type: "text",
          text: `${taskText}\n\n${verboseDetails}`,
        },
        ...imageBlocks,
      ])
    })
  }

  private async resumeTaskFromHistory() {
    const modifiedClaudeMessages = await this.getSavedClaudeMessages()

    // Need to modify claude messages for good ux, i.e. if the last message is an api_request_started, then remove it otherwise the user will think the request is still loading
    const lastApiReqStartedIndex = modifiedClaudeMessages.reduce(
      (lastIndex, m, index) => (m.type === "say" && m.say === "api_req_started" ? index : lastIndex),
      -1
    )
    const lastApiReqFinishedIndex = modifiedClaudeMessages.reduce(
      (lastIndex, m, index) => (m.type === "say" && m.say === "api_req_finished" ? index : lastIndex),
      -1
    )
    if (lastApiReqStartedIndex > lastApiReqFinishedIndex && lastApiReqStartedIndex !== -1) {
      modifiedClaudeMessages.splice(lastApiReqStartedIndex, 1)
    }

    // Remove any resume messages that may have been added before
    const lastRelevantMessageIndex = findLastIndex(
      modifiedClaudeMessages,
      (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")
    )
    if (lastRelevantMessageIndex !== -1) {
      modifiedClaudeMessages.splice(lastRelevantMessageIndex + 1)
    }

    await this.overwriteClaudeMessages(modifiedClaudeMessages)
    this.claudeMessages = await this.getSavedClaudeMessages()

    const lastClaudeMessage = this.claudeMessages
      .slice()
      .reverse()
      .find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))

    let askType: ClaudeAsk
    if (lastClaudeMessage?.ask === "completion_result") {
      askType = "resume_completed_task"
    } else {
      askType = "resume_task"
    }

    const { response, text, images } = await this.ask(askType)

    let newUserContent: UserContent = []
    if (response === "messageResponse") {
      await this.say("user_feedback", text, images)
      if (images && images.length > 0) {
        newUserContent.push(...this.formatImagesIntoBlocks(images))
      }
      if (text) {
        newUserContent.push({ type: "text", text })
      }
    }

    const existingApiConversationHistory: Anthropic.Messages.MessageParam[] =
      await this.getSavedApiConversationHistory()

    let modifiedOldUserContent: UserContent
    let modifiedApiConversationHistory: Anthropic.Messages.MessageParam[]
    if (existingApiConversationHistory.length > 0) {
      const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]

      if (lastMessage.role === "assistant") {
        const content = Array.isArray(lastMessage.content)
          ? lastMessage.content
          : [{ type: "text", text: lastMessage.content }]
        const hasToolUse = content.some((block) => block.type === "tool_use")

        
        if (hasToolUse) {
          const toolUseBlocks = content.filter(
            (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use"
          );
          
          const toolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => ({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Task was interrupted before this tool call could be completed.",
          }));
          modifiedApiConversationHistory = [...existingApiConversationHistory]
          modifiedOldUserContent = [...toolResponses]
        } else {
          modifiedApiConversationHistory = [...existingApiConversationHistory]
          modifiedOldUserContent = []
        }
      } else if (lastMessage.role === "user") {
        const previousAssistantMessage =
          existingApiConversationHistory[existingApiConversationHistory.length - 2]

        const existingUserContent: UserContent = Array.isArray(lastMessage.content)
          ? lastMessage.content
          : [{ type: "text", text: lastMessage.content }]
        if (previousAssistantMessage && previousAssistantMessage.role === "assistant") {
          const assistantContent = Array.isArray(previousAssistantMessage.content)
            ? previousAssistantMessage.content
            : [{ type: "text", text: previousAssistantMessage.content }]

          const toolUseBlocks = assistantContent.filter(
            (block) => block.type === "tool_use"
          ) as Anthropic.Messages.ToolUseBlock[]

          if (toolUseBlocks.length > 0) {
            const existingToolResults = existingUserContent.filter(
              (block) => block.type === "tool_result"
            ) as Anthropic.ToolResultBlockParam[]

            const missingToolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks
              .filter(
                (toolUse) => !existingToolResults.some((result) => result.tool_use_id === toolUse.id)
              )
              .map((toolUse) => ({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: "Task was interrupted before this tool call could be completed.",
              }))

            modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
            modifiedOldUserContent = [...existingUserContent, ...missingToolResponses]
          } else {
            modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
            modifiedOldUserContent = [...existingUserContent]
          }
        } else {
          modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
          modifiedOldUserContent = [...existingUserContent]
        }
      } else {
        throw new Error("Unexpected: Last message is not a user or assistant message")
      }
    } else {
      throw new Error("Unexpected: No existing API conversation history")
    }

    const modifiedOldUserContentText = modifiedOldUserContent.find((block) => block.type === "text")?.text
    const newUserContentText = newUserContent.find((block) => block.type === "text")?.text
    const agoText = (() => {
      const timestamp = lastClaudeMessage?.ts ?? Date.now()
      const now = Date.now()
      const diff = now - timestamp
      const minutes = Math.floor(diff / 60000)
      const hours = Math.floor(minutes / 60)
      const days = Math.floor(hours / 24)

      if (days > 0) {
        return `${days} day${days > 1 ? "s" : ""} ago`
      }
      if (hours > 0) {
        return `${hours} hour${hours > 1 ? "s" : ""} ago`
      }
      if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
      }
      return "just now"
    })()

    const combinedText =
      `Task resumption: This autonomous coding task was interrupted ${agoText}. It may or may not be complete, so please reassess the task context. Be aware that the project state may have changed since then. The current working directory is now ${cwd}. If the task has not been completed, retry the last step before interruption and proceed with completing the task.` +
      (modifiedOldUserContentText
        ? `\n\nLast recorded user input before interruption:\n<previous_message>\n${modifiedOldUserContentText}\n</previous_message>\n`
        : "") +
      (newUserContentText
        ? `\n\nNew instructions for task continuation:\n<user_message>\n${newUserContentText}\n</user_message>\n`
        : "") +
      `\n\n${await this.getPotentiallyRelevantDetails()}`

    const newUserContentImages = newUserContent.filter((block) => block.type === "image")
    const combinedModifiedOldUserContentWithNewUserContent: UserContent = (
      modifiedOldUserContent.filter((block) => block.type !== "text") as UserContent
    ).concat([{ type: "text", text: combinedText }, ...newUserContentImages])

    await this.overwriteApiConversationHistory(modifiedApiConversationHistory)
    await this.initiateTaskLoop(combinedModifiedOldUserContentWithNewUserContent)
  }

  private async initiateTaskLoop(userContent: UserContent): Promise<void> {
    let nextUserContent = userContent

    while (!this.abort) {
      const { didEndLoop } = await this.apiOperations.recursivelyMakeClaudeRequests(nextUserContent)

      if (didEndLoop) {
        break
      } else {
        nextUserContent = [
          {
            type: "text",
            text: "If you have completed the user's task, use the attempt_completion tool. If you require additional information from the user, use the ask_followup_question tool. Otherwise, if you have not completed the task and do not need additional information, then proceed with the next step of the task. (This is an automated message, so do not respond to it conversationally.)",
          },
        ]
      }
    }
  }

  abortTask() {
    this.abort = true
    const runningProcessId = this.executeCommandRunningProcess?.pid
    if (runningProcessId) {
      treeKill(runningProcessId, "SIGTERM")
    }
  }

  async executeTool(toolName: ToolName, toolInput: any): Promise<ToolResponse> {
    return this.toolExecutions.executeTool(toolName, toolInput)
  }

  calculateApiCost(
    inputTokens: number,
    outputTokens: number,
    cacheCreationInputTokens?: number,
    cacheReadInputTokens?: number
  ): number {
    const modelCacheWritesPrice = this.api.getModel().info.cacheWritesPrice
    let cacheWritesCost = 0
    if (cacheCreationInputTokens && modelCacheWritesPrice) {
      cacheWritesCost = (modelCacheWritesPrice / 1_000_000) * cacheCreationInputTokens
    }
    const modelCacheReadsPrice = this.api.getModel().info.cacheReadsPrice
    let cacheReadsCost = 0
    if (cacheReadInputTokens && modelCacheReadsPrice) {
      cacheReadsCost = (modelCacheReadsPrice / 1_000_000) * cacheReadInputTokens
    }
    const baseInputCost = (this.api.getModel().info.inputPrice / 1_000_000) * inputTokens
    const outputCost = (this.api.getModel().info.outputPrice / 1_000_000) * outputTokens
    const totalCost = cacheWritesCost + cacheReadsCost + baseInputCost + outputCost
    return totalCost
  }

  // Helper methods

  private formatImagesIntoBlocks(images?: string[]): Anthropic.ImageBlockParam[] {
    return images
      ? images.map((dataUrl) => {
          const [rest, base64] = dataUrl.split(",")
          const mimeType = rest.split(":")[1].split(";")[0]
          return {
            type: "image",
            source: { type: "base64", media_type: mimeType, data: base64 },
          } as Anthropic.ImageBlockParam
        })
      : []
  }

  private async getPotentiallyRelevantDetails(verbose: boolean = false) {
    let details = `<potentially_relevant_details>
# VSCode Visible Files:
${
  vscode.window.visibleTextEditors
    ?.map((editor) => editor.document?.uri?.fsPath)
    .filter(Boolean)
    .map((absolutePath) => path.relative(cwd, absolutePath))
    .join("\n") || "(No files open)"
}

# VSCode Opened Tabs:
${
  vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .map((tab) => (tab.input as vscode.TabInputText)?.uri?.fsPath)
    .filter(Boolean)
    .map((absolutePath) => path.relative(cwd, absolutePath))
    .join("\n") || "(No tabs open)"
}
`

    if (verbose) {
      const isDesktop = cwd === path.join(os.homedir(), "Desktop")
      const files = await this.fileOperations.listFiles(cwd, !isDesktop ? "true" : "false")
      details += `\n# Current Working Directory ('${cwd}') File Structure:${
        isDesktop
          ? "\n(Desktop so only top-level contents shown for brevity, use list_files to explore further if necessary)"
          : ""
      }:\n${files}\n`
    }

    details += "</potentially_relevant_details>"
    return details
  }

  async formatGenericToolFeedback(feedback?: string) {
    return `The user denied this operation and provided the following feedback:\n<feedback>\n${feedback}\n</feedback>\n\n${await this.getPotentiallyRelevantDetails()}`
  }

  // File operations methods
  async writeToFile(relPath?: string, newContent?: string): Promise<ToolResponse> {
    return this.fileOperations.writeToFile(relPath, newContent)
  }

  async readFile(relPath?: string): Promise<ToolResponse> {
    return this.fileOperations.readFile(relPath)
  }

  async listFiles(relDirPath?: string, recursiveRaw?: string): Promise<ToolResponse> {
    return this.fileOperations.listFiles(relDirPath, recursiveRaw)
  }

  async listCodeDefinitionNames(relDirPath?: string): Promise<ToolResponse> {
    return this.fileOperations.listCodeDefinitionNames(relDirPath)
  }

  async searchFiles(relDirPath: string, regex: string, filePattern?: string): Promise<ToolResponse> {
    return this.fileOperations.searchFiles(relDirPath, regex, filePattern)
  }

  // API operations methods
  async attemptApiRequest(): Promise<Anthropic.Messages.Message> {
    return this.apiOperations.attemptApiRequest()
  }

  async recursivelyMakeClaudeRequests(userContent: UserContent): Promise<ClaudeRequestResult> {
    return this.apiOperations.recursivelyMakeClaudeRequests(userContent)
  }

  // Tool execution methods
  async executeCommand(command?: string, returnEmptyStringOnSuccess: boolean = false): Promise<ToolResponse> {
    return this.toolExecutions.executeCommand(command, returnEmptyStringOnSuccess)
  }

  async askFollowupQuestion(question?: string): Promise<ToolResponse> {
    return this.toolExecutions.askFollowupQuestion(question)
  }

  async attemptCompletion(result?: string, command?: string): Promise<ToolResponse> {
    return this.toolExecutions.attemptCompletion(result, command)
  }

  // History management methods
  private async addToClaudeMessages(message: ClaudeMessage) {
    this.claudeMessages.push(message)
    await this.saveClaudeMessages()
  }

  private async saveClaudeMessages() {
    try {
      const filePath = path.join(await this.ensureTaskDirectoryExists(), "claude_messages.json")
      await fs.writeFile(filePath, JSON.stringify(this.claudeMessages))
      const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(this.claudeMessages.slice(1))))
      const taskMessage = this.claudeMessages[0]
      const lastRelevantMessage =
        this.claudeMessages[
          findLastIndex(
            this.claudeMessages,
            (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")
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
      console.error("Failed to save claude messages:", error)
    }
  }

  async addToApiConversationHistory(message: Anthropic.MessageParam) {
    this.apiConversationHistory.push(message)
    await this.saveApiConversationHistory()
  }

  async overwriteApiConversationHistory(newHistory: Anthropic.MessageParam[]) {
    this.apiConversationHistory = newHistory
    await this.saveApiConversationHistory()
  }

  private async saveApiConversationHistory() {
    try {
      const filePath = path.join(await this.ensureTaskDirectoryExists(), "api_conversation_history.json")
      await fs.writeFile(filePath, JSON.stringify(this.apiConversationHistory))
    } catch (error) {
      console.error("Failed to save API conversation history:", error)
    }
  }

  private async ensureTaskDirectoryExists(): Promise<string> {
    const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
    if (!globalStoragePath) {
      throw new Error("Global storage uri is invalid")
    }
    const taskDir = path.join(globalStoragePath, "tasks", this.taskId)
    await fs.mkdir(taskDir, { recursive: true })
    return taskDir
  }

  private async getSavedApiConversationHistory(): Promise<Anthropic.MessageParam[]> {
    const filePath = path.join(await this.ensureTaskDirectoryExists(), "api_conversation_history.json")
    const fileExists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false)
    if (fileExists) {
      return JSON.parse(await fs.readFile(filePath, "utf8"))
    }
    return []
  }

  private async getSavedClaudeMessages(): Promise<ClaudeMessage[]> {
    const filePath = path.join(await this.ensureTaskDirectoryExists(), "claude_messages.json")
    const fileExists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false)
    if (fileExists) {
      return JSON.parse(await fs.readFile(filePath, "utf8"))
    }
    return []
  }

  private async overwriteClaudeMessages(newMessages: ClaudeMessage[]) {
    this.claudeMessages = newMessages
    await this.saveClaudeMessages()
  }

  // Update the formatIntoToolResponse method to match the interface
  formatIntoToolResponse(text: string, images?: string[]): ToolResponse {
    const response: ToolResponse = [{ type: "text", text }]
    if (images && images.length > 0) {
      response.push(...this.formatImagesIntoBlocks(images))
    }
    return response
  }
}
