// ApiOperations.ts
import { Anthropic } from "@anthropic-ai/sdk"
import { UserContent } from "../shared/UserContent"
import { ClaudeDevCore } from "../shared/ClaudeDevCore"
import { ApiOperations } from "../shared/ApiOperations"
import { getTools } from "../tools"
import { findLast } from "../utils"
import { truncateHalfConversation } from "../utils/context-management"
import { serializeError } from "serialize-error"
import { getSystemPrompt } from "../systemPrompt"
import { ToolName } from "../shared/Tool"
import { ClaudeRequestResult } from "../shared/ClaudeRequestResult"

export class ApiOperationsImpl implements ApiOperations {
  constructor(private core: ClaudeDevCore) {}

  async attemptApiRequest(): Promise<Anthropic.Messages.Message> {
    try {
      let systemPrompt = getSystemPrompt(this.core.cwd)
      if (this.core.customInstructions && this.core.customInstructions.trim()) {
        systemPrompt += `
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user. They should be followed and given precedence in case of conflicts with previous instructions.

${this.core.customInstructions.trim()}
`
      }

      const lastApiReqFinished = findLast(this.core.claudeMessages, (m) => m.say === "api_req_finished")
      if (lastApiReqFinished && lastApiReqFinished.text) {
        const {
          tokensIn,
          tokensOut,
          cacheWrites,
          cacheReads,
        }: { tokensIn?: number; tokensOut?: number; cacheWrites?: number; cacheReads?: number } = JSON.parse(
          lastApiReqFinished.text
        )
        const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
        const contextWindow = this.core.api.getModel().info.contextWindow
        const maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8)
        if (totalTokens >= maxAllowedSize) {
          const truncatedMessages = truncateHalfConversation(this.core.apiConversationHistory)
          await this.core.overwriteApiConversationHistory(truncatedMessages)
        }
      }
      const { message, userCredits } = await this.core.api.createMessage(
        systemPrompt,
        this.core.apiConversationHistory,
        getTools(this.core.cwd)
      )
      if (userCredits !== undefined) {
        console.log("Updating credits", userCredits)
        // TODO: update credits
      }
      return message
    } catch (error) {
      const { response } = await this.core.ask(
        "api_req_failed",
        error.message ?? JSON.stringify(serializeError(error), null, 2)
      )
      if (response !== "yesButtonTapped") {
        throw new Error("API request failed")
      }
      await this.core.say("api_req_retried")
      return this.attemptApiRequest()
    }
  }

  async recursivelyMakeClaudeRequests(userContent: UserContent): Promise<ClaudeRequestResult> {
    if (this.core.abort) {
      throw new Error("ClaudeDev instance aborted")
    }

    await this.core.addToApiConversationHistory({ role: "user", content: userContent })
    if (this.core.requestCount >= this.core.maxRequestsPerTask) {
      const { response } = await this.core.ask(
        "request_limit_reached",
        `Claude Dev has reached the maximum number of requests for this task. Would you like to reset the count and allow him to proceed?`
      )

      if (response === "yesButtonTapped") {
        this.core.requestCount = 0
      } else {
        await this.core.addToApiConversationHistory({
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Failure: I have reached the request limit for this task. Do you have a new task for me?",
            },
          ],
        })
        return { didEndLoop: true, inputTokens: 0, outputTokens: 0 }
      }
    }

    if (!this.core.shouldSkipNextApiReqStartedMessage) {
      await this.core.say(
        "api_req_started",
        JSON.stringify({
          request: this.core.api.createUserReadableRequest(userContent),
        })
      )
    } else {
      this.core.shouldSkipNextApiReqStartedMessage = false
    }
    try {
      const response = await this.attemptApiRequest()
      this.core.requestCount++

      if (this.core.abort) {
        throw new Error("ClaudeDev instance aborted")
      }

      let assistantResponses: Anthropic.Messages.ContentBlock[] = []
      let inputTokens = response.usage.input_tokens
      let outputTokens = response.usage.output_tokens
      let cacheCreationInputTokens =
        (response as Anthropic.Beta.PromptCaching.Messages.PromptCachingBetaMessage).usage
          .cache_creation_input_tokens || undefined
      let cacheReadInputTokens =
        (response as Anthropic.Beta.PromptCaching.Messages.PromptCachingBetaMessage).usage
          .cache_read_input_tokens || undefined
      await this.core.say(
        "api_req_finished",
        JSON.stringify({
          tokensIn: inputTokens,
          tokensOut: outputTokens,
          cacheWrites: cacheCreationInputTokens,
          cacheReads: cacheReadInputTokens,
          cost: this.core.calculateApiCost(
            inputTokens,
            outputTokens,
            cacheCreationInputTokens,
            cacheReadInputTokens
          ),
        })
      )

      for (const contentBlock of response.content) {
        if (contentBlock.type === "text") {
          assistantResponses.push(contentBlock)
          await this.core.say("text", contentBlock.text)
        }
      }

      let toolResults: Anthropic.ToolResultBlockParam[] = []
      let attemptCompletionBlock: Anthropic.Messages.ToolUseBlock | undefined
      for (const contentBlock of response.content) {
        if (contentBlock.type === "tool_use") {
          assistantResponses.push(contentBlock)
          const toolName = contentBlock.name as ToolName
          const toolInput = contentBlock.input
          const toolUseId = contentBlock.id
          if (toolName === "attempt_completion") {
            attemptCompletionBlock = contentBlock
          } else {
            const result = await this.core.executeTool(toolName, toolInput)
            toolResults.push({ type: "tool_result", tool_use_id: toolUseId, content: result })
          }
        }
      }

      if (assistantResponses.length > 0) {
        await this.core.addToApiConversationHistory({ role: "assistant", content: assistantResponses })
      } else {
        await this.core.say("error", "Unexpected Error: No assistant messages were found in the API response")
        await this.core.addToApiConversationHistory({
          role: "assistant",
          content: [{ type: "text", text: "Failure: I did not have a response to provide." }],
        })
      }

      let didEndLoop = false

      if (attemptCompletionBlock) {
        let result = await this.core.executeTool(
          attemptCompletionBlock.name as ToolName,
          attemptCompletionBlock.input
        )
        if (result === "") {
          didEndLoop = true
          result = "The user is satisfied with the result."
        }
        toolResults.push({ type: "tool_result", tool_use_id: attemptCompletionBlock.id, content: result })
      }

      if (toolResults.length > 0) {
        if (didEndLoop) {
          await this.core.addToApiConversationHistory({ role: "user", content: toolResults })
          await this.core.addToApiConversationHistory({
            role: "assistant",
            content: [
              {
                type: "text",
                text: "I am pleased you are satisfied with the result. Do you have a new task for me?",
              },
            ],
          })
        } else {
          const {
            didEndLoop: recDidEndLoop,
            inputTokens: recInputTokens,
            outputTokens: recOutputTokens,
          } = await this.recursivelyMakeClaudeRequests(toolResults)
          didEndLoop = recDidEndLoop
          inputTokens += recInputTokens
          outputTokens += recOutputTokens
        }
      }

      return { didEndLoop, inputTokens, outputTokens }
    } catch (error) {
      return { didEndLoop: true, inputTokens: 0, outputTokens: 0 }
    }
  }
}