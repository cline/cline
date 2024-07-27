import { Anthropic } from "@anthropic-ai/sdk"
import { ClaudeRequestResult } from "./shared/ClaudeRequestResult"
import { ToolExecutor } from "./ToolExecutor"
import { SYSTEM_PROMPT, tools } from "./Constants"
import { ClaudeDev } from "./ClaudeDev"

export class ApiHandler {
	private client: Anthropic
	private conversationHistory: Anthropic.MessageParam[]
	private claudeDev: ClaudeDev

	constructor(client: Anthropic, conversationHistory: Anthropic.MessageParam[], claudeDev: ClaudeDev) {
		this.client = client
		this.conversationHistory = conversationHistory
		this.claudeDev = claudeDev
	}

	updateClient(client: Anthropic) {
		this.client = client
	}

	async makeRequest(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>,
		requestCount: number,
		maxRequestsPerTask: number,
		toolExecutor: ToolExecutor
	): Promise<ClaudeRequestResult> {
		this.conversationHistory.push({ role: "user", content: userContent })

		try {
			// Log the API request
			await this.claudeDev.say(
				"api_req_started",
				JSON.stringify({
					request: {
						model: "claude-3-5-sonnet-20240620",
						max_tokens: 4096,
						system: "(see SYSTEM_PROMPT in Constants.ts)",
						messages: [{ conversation_history: "..." }, { role: "user", content: userContent }],
						tools: "(see tools in Constants.ts)",
						tool_choice: { type: "auto" },
					},
				})
			)

			const response = await this.client.messages.create({
				model: "claude-3-5-sonnet-20240620",
				max_tokens: 4096,
				system: SYSTEM_PROMPT,
				messages: this.conversationHistory,
				tools: tools,
				tool_choice: { type: "auto" },
			})

			let assistantResponses: Anthropic.Messages.ContentBlock[] = []
			let inputTokens = response.usage.input_tokens
			let outputTokens = response.usage.output_tokens

			// Log the API response
			await this.claudeDev.say(
				"api_req_finished",
				JSON.stringify({
					tokensIn: inputTokens,
					tokensOut: outputTokens,
					cost: this.calculateApiCost(inputTokens, outputTokens),
				})
			)

			for (const contentBlock of response.content) {
				if (contentBlock.type === "text") {
					assistantResponses.push(contentBlock)
					await this.claudeDev.say("text", contentBlock.text)
				}
			}

			let toolResults: Anthropic.ToolResultBlockParam[] = []
			let attemptCompletionBlock: Anthropic.Messages.ToolUseBlock | undefined
			for (const contentBlock of response.content) {
				if (contentBlock.type === "tool_use") {
					assistantResponses.push(contentBlock)
					const toolName = contentBlock.name as any
					const toolInput = contentBlock.input
					const toolUseId = contentBlock.id
					if (toolName === "attempt_completion") {
						attemptCompletionBlock = contentBlock
					} else {
						const result = await toolExecutor.executeTool(toolName, toolInput)
						toolResults.push({ type: "tool_result", tool_use_id: toolUseId, content: result })
					}
				}
			}

			if (assistantResponses.length > 0) {
				this.conversationHistory.push({ role: "assistant", content: assistantResponses })
			}

			let didCompleteTask = false

			if (attemptCompletionBlock) {
				let result = await toolExecutor.executeTool(
					attemptCompletionBlock.name as any,
					attemptCompletionBlock.input
				)
				if (result === "") {
					didCompleteTask = true
					result = "The user is satisfied with the result."
				}
				toolResults.push({ type: "tool_result", tool_use_id: attemptCompletionBlock.id, content: result })
			}

			if (toolResults.length > 0 && !didCompleteTask) {
				const {
					didCompleteTask: recDidCompleteTask,
					inputTokens: recInputTokens,
					outputTokens: recOutputTokens,
				} = await this.makeRequest(toolResults, requestCount + 1, maxRequestsPerTask, toolExecutor)
				didCompleteTask = recDidCompleteTask
				inputTokens += recInputTokens
				outputTokens += recOutputTokens
			}

			return { didCompleteTask, inputTokens, outputTokens }
		} catch (error: any) {
			console.error(`API request failed:\n${error.message ?? JSON.stringify(error, null, 2)}`)
			await this.claudeDev.say("error", `API request failed:\n${error.message ?? JSON.stringify(error, null, 2)}`)
			return { didCompleteTask: true, inputTokens: 0, outputTokens: 0 }
		}
	}

	private calculateApiCost(inputTokens: number, outputTokens: number): number {
		const INPUT_COST_PER_MILLION = 3.0 // $3 per million input tokens
		const OUTPUT_COST_PER_MILLION = 15.0 // $15 per million output tokens
		const inputCost = (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION
		const outputCost = (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION
		return inputCost + outputCost
	}
}
