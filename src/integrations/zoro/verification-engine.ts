import * as fs from "fs"
import * as path from "path"
import { executeTool, getController, getWorkspaceDirectory, TOOL_DEFINITIONS } from "./delegates"
import { getCheckingWithUserVerificationPrompt } from "./prompts/verify-checking"
import { getCodeStyleVerificationPrompt } from "./prompts/verify-code-style"
import { getPlanningVerificationPrompt } from "./prompts/verify-planning"
import { getSubstepVerificationPrompt } from "./prompts/verify-substep"
import type { ConversationMessage } from "./providers/base"
import { getProviderAdapter } from "./providers/factory"
import { EnforcementRequest, EnforcementResponse } from "./types"

interface ChatMessage {
	role: "user" | "assistant"
	content: string
	timestamp: string
}

export async function runVerification(request: EnforcementRequest): Promise<EnforcementResponse> {
	console.log("[verification-engine] 🚀 START runVerification:", {
		chat_id: request.chat_id,
		step_id: request.step_id,
		node_type: request.node?.type,
		has_node: !!request.node,
	})

	try {
		const chatHistory = await loadChatHistory(request.chat_id)
		const planOutput = await loadPlanOutput(request.chat_id, request.step_id)

		const nodeType = request.node?.type || "code-style"

		const prompt = buildPrompt(nodeType, request, chatHistory, planOutput)

		const llmResponse = await callLLM(prompt)
		const parsed = parseVerificationResponse(llmResponse)

		return parsed
	} catch (error) {
		console.error("[verification-engine] Error:", error)
		return {
			verdict: "unclear",
			overview: `## Verification Failed\n- Error: ${error instanceof Error ? error.message : "Unknown error"}`,
			rules_analysis: [],
			files_summary: [],
			code_blocks: [],
		}
	}
}

async function loadChatHistory(chatId: string): Promise<string> {
	console.log("[verification-engine] Loading chat history for:", chatId)

	try {
		const controller = getController()
		if (!controller || !controller.task) {
			return "No active task found"
		}

		const apiHistory = controller.task.messageStateHandler.getApiConversationHistory()

		if (!apiHistory || apiHistory.length === 0) {
			return "No conversation history available"
		}

		const KEEP_LAST_N = 50 // Keep last 50 messages (~40K tokens, safe for 200K limit)

		// Take last N messages to stay under token limit
		const recentMessages = apiHistory.slice(-KEEP_LAST_N)
		const startIndex = apiHistory.length - recentMessages.length

		let formatted = "=== CHAT HISTORY ===\n\n"

		if (apiHistory.length > KEEP_LAST_N) {
			formatted += `(Showing last ${KEEP_LAST_N} of ${apiHistory.length} total messages)\n\n`
		}

		for (let i = 0; i < recentMessages.length; i++) {
			const msg = recentMessages[i]
			const msgNum = startIndex + i + 1
			formatted += `--- Message ${msgNum} (${msg.role.toUpperCase()}) ---\n`

			if (typeof msg.content === "string") {
				formatted += msg.content + "\n\n"
			} else if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "text") {
						formatted += block.text + "\n"
					} else if (block.type === "tool_use") {
						formatted += `[Tool: ${block.name}]\n`
					} else if (block.type === "tool_result") {
						formatted += `[Tool Result]\n`
					}
				}
				formatted += "\n"
			}
		}

		return formatted
	} catch (error) {
		console.error("[verification-engine] Error loading chat history:", error)
		return `Error loading chat history: ${error instanceof Error ? error.message : "Unknown error"}`
	}
}

async function loadPlanOutput(chatId: string, stepId?: string): Promise<string> {
	console.log("[verification-engine] Loading plan output for:", chatId, stepId)

	try {
		const cwd = getWorkspaceDirectory()
		const planPath = path.join(cwd, ".zoro", "generated", "assistant", chatId, "plan.json")

		if (!fs.existsSync(planPath)) {
			return `No plan found at ${planPath}`
		}

		const planData = JSON.parse(fs.readFileSync(planPath, "utf-8"))

		if (stepId && planData.steps) {
			const step = planData.steps.find((s: any) => s.id === stepId)
			if (step) {
				return JSON.stringify(step, null, 2)
			}
		}

		return JSON.stringify(planData, null, 2)
	} catch (error) {
		console.error("[verification-engine] Error loading plan:", error)
		return `Error loading plan: ${error instanceof Error ? error.message : "Unknown error"}`
	}
}

function buildPrompt(nodeType: string, request: EnforcementRequest, chatHistory: string, planOutput: string): string {
	const stepDescription = request.node?.description || "No description provided"
	const substeps = request.node?.substeps || []
	const rules = request.node?.rules || []

	switch (nodeType) {
		case "code-style":
			return getCodeStyleVerificationPrompt(stepDescription, substeps, rules, chatHistory)

		case "checking-with-user":
			return getCheckingWithUserVerificationPrompt(stepDescription, rules, chatHistory)

		case "planning":
			return getPlanningVerificationPrompt(stepDescription, rules, chatHistory, planOutput)

		default:
			return getCodeStyleVerificationPrompt(stepDescription, substeps, rules, chatHistory)
	}
}

async function callLLM(prompt: string, verificationType: "step" | "substep" = "step"): Promise<string> {
	console.log("[verification-engine] Two-phase verification starting, type:", verificationType)

	try {
		const controller = getController()
		if (!controller || !controller.task) {
			return JSON.stringify({
				verdict: "unclear",
				overview: "## Verification Failed\n- No active Cline task",
				rules_analysis: [],
			})
		}

		const api = controller.task.api
		if (!api) {
			return JSON.stringify({
				verdict: "unclear",
				overview: "## Verification Failed\n- No LLM API available",
				rules_analysis: [],
			})
		}

		// 🎯 Get provider adapter for this API
		const adapter = getProviderAdapter(api)
		console.log(`[verification-engine] Using ${adapter.name} provider adapter`)

		const systemPrompt = "You are a code verification assistant. Use tools to investigate, then provide a final JSON verdict."
		const messages: ConversationMessage[] = [{ role: "user", content: [{ type: "text", text: prompt }] }]

		console.log("[verification-engine] PHASE 1: Investigation (7 iterations max)")

		for (let i = 0; i < 7; i++) {
			console.log(`[verification-engine] Iteration ${i + 1}/7`)

			// 🎯 Prepare messages using provider adapter
			const preparedMessages = adapter.prepareMessages(messages)

			const stream = api.createMessage(systemPrompt, preparedMessages, TOOL_DEFINITIONS)

			// 🎯 Consume stream using provider adapter
			const streamResult = await adapter.consumeStream(stream, {
				onText: () => {
					// Optional: log text chunks
				},
				onToolCall: (id, name) => {
					console.log("[verification-engine] Tool:", name)
				},
				onThinking: () => {
					// Optional: log thinking
				},
				onComplete: () => {
					// Stream complete
				},
			})

			// 🎯 Validate tool calls using provider adapter (e.g., filter malformed JSON)
			const validToolCalls = adapter.validateToolCalls
				? adapter.validateToolCalls(streamResult.toolCalls)
				: streamResult.toolCalls

			console.log(`[verification-engine] Valid tool calls: ${validToolCalls.length}/${streamResult.toolCalls.length}`)

			// Execute tools and collect results (ONLY valid tools)
			const toolExecutions: Array<{
				id: string
				name: string
				input: any
				result: string
			}> = []

			for (const toolCall of validToolCalls) {
				try {
					const toolInput = JSON.parse(toolCall.arguments)
					const toolResult = await executeTool(toolCall.name, toolInput)

					toolExecutions.push({
						id: toolCall.id,
						name: toolCall.name,
						input: toolInput,
						result: toolResult,
					})
				} catch (error) {
					console.error("[verification-engine] Tool execution failed:", error)
					toolExecutions.push({
						id: toolCall.id,
						name: toolCall.name,
						input: {},
						result: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
					})
				}
			}

			// 🎯 Build assistant message using provider adapter (SAME valid tools)
			const assistantMessage = adapter.buildAssistantMessage(
				streamResult.text,
				validToolCalls,
				streamResult.thinking,
				streamResult.thinkingSignature,
			)

			messages.push(assistantMessage)

			// 🎯 Add tool results using provider adapter
			if (toolExecutions.length > 0) {
				const toolResultMessage = adapter.buildToolResultMessage(toolExecutions)
				messages.push(toolResultMessage)
			}

			// Add iteration tracking after tool results
			if (streamResult.toolCalls.length > 0 && i < 6) {
				const iterationMsg =
					i >= 5
						? `[System: Iteration ${i + 1} of 7. ⚠️ FINAL ITERATION - complete your task now!]`
						: `[System: Iteration ${i + 1} of 7]`

				messages.push({
					role: "user",
					content: [{ type: "text", text: iterationMsg }],
				})
			}

			if (validToolCalls.length === 0) {
				console.log("[verification-engine] No more valid tools requested, stopping")
				break
			}
		}

		console.log("[verification-engine] PHASE 2: Forcing verdict (no tools)")

		// Substeps now use the same rich schema as steps
		const schemaPrompt =
			verificationType === "substep"
				? `Based on your investigation above, return ONLY valid JSON:

{
  "verdict": "done" | "not_done" | "partial" | "unclear",
  "overview": "## Summary\\n- What was implemented in this substep\\n- Key changes made",
  "rules_analysis": [
    {
      "rule_id": "rule-123",
      "rule_text": "[code-style] Full rule text",
      "followed": true,
      "evidence": "Concrete evidence from code/chat showing rule was followed",
      "used_in_substeps": []
    }
  ],
  "files_summary": [
    {
      "path": "path/to/file.ts",
      "lines_changed": "45-50, 120-135",
      "changes": "What changed in this file",
      "impact": "Why this change matters",
      "substeps_fulfilled": []
    }
  ],
  "code_blocks": [
    {
      "file": "path/to/file.ts",
      "lines": "125-130",
      "code": "actual code snippet",
      "annotation": "Explanation of what this code does"
    }
  ]
}

Return ONLY the JSON object, nothing else.`
				: `Based on your investigation above, return ONLY valid JSON:

{
  "verdict": "done" | "not_done" | "partial" | "unclear",
  "overview": "## Summary\\n- Bullet point 1\\n- Bullet point 2",
  "rules_analysis": [
    {
      "rule_id": "rule-id-here",
      "rule_text": "Full rule text",
      "followed": true,
      "evidence": "Specific evidence from chat/code"
    }
  ],
  "files_summary": [],
  "code_blocks": []
}

Return ONLY the JSON object, nothing else.`

		messages.push({
			role: "user",
			content: [{ type: "text", text: schemaPrompt }],
		})

		// 🎯 Prepare messages for final verdict using provider adapter
		const finalPreparedMessages = adapter.prepareMessages(messages)

		const verdictStream = api.createMessage(systemPrompt, finalPreparedMessages, TOOL_DEFINITIONS)

		// 🎯 Consume verdict stream using provider adapter
		const verdictResult = await adapter.consumeStream(verdictStream, {
			onText: () => {},
			onToolCall: () => {},
			onThinking: () => {},
			onComplete: () => {},
		})

		const verdictText = verdictResult.text

		console.log("[verification-engine] Verdict received")
		return verdictText
	} catch (error) {
		console.error("[verification-engine] Error:", error)
		return JSON.stringify({
			verdict: "unclear",
			overview: `## Verification Failed\n- Error: ${error instanceof Error ? error.message : "Unknown error"}`,
			rules_analysis: [],
		})
	}
}

function parseVerificationResponse(llmResponse: string): EnforcementResponse {
	const cleaned = stripMarkdownJson(llmResponse)

	try {
		const parsed = JSON.parse(cleaned)
		return {
			verdict: parsed.verdict || "unclear",
			overview: parsed.overview || parsed.message || "No overview provided",
			rules_analysis: parsed.rules_analysis || [],
			files_summary: parsed.files_summary || [],
			code_blocks: parsed.code_blocks || [],
		}
	} catch (error) {
		console.error("[verification-engine] JSON parse error:", error)
		return {
			verdict: "unclear",
			overview: `## Parse Error\n- Failed to parse LLM response\n- Response: ${llmResponse.substring(0, 200)}...`,
			rules_analysis: [],
			files_summary: [],
			code_blocks: [],
		}
	}
}

function stripMarkdownJson(text: string): string {
	const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
	if (jsonMatch) {
		return jsonMatch[1].trim()
	}

	const codeMatch = text.match(/```\s*([\s\S]*?)\s*```/)
	if (codeMatch) {
		return codeMatch[1].trim()
	}

	return text.trim()
}

export async function runSubstepVerification(
	chatId: string,
	stepDescription: string,
	substepDescription: string,
	substepId: string,
	rules: Array<{ rule_id: string; name: string; description: string }>,
): Promise<EnforcementResponse> {
	console.log("[verification-engine] 🔍 Verifying substep:", substepId)

	try {
		// Load chat history only - let Cline use tools to investigate files
		const chatHistory = await loadChatHistory(chatId)

		// Build substep-specific prompt (no preloaded git diff/files)
		const prompt = getSubstepVerificationPrompt(stepDescription, substepDescription, rules, chatHistory)

		// Use callLLM with 'substep' type - now returns same rich schema as steps
		console.log("[verification-engine] Calling LLM with tools for substep verification")
		const llmResponse = await callLLM(prompt, "substep")
		// Use same parser as steps - returns VerifyResult/EnforcementResponse
		const parsed = parseVerificationResponse(llmResponse)

		return parsed
	} catch (error) {
		console.error("[verification-engine] Substep verification error:", error)
		return {
			verdict: "unclear",
			overview: `## Substep Verification Failed\n- Substep: ${substepDescription}\n- Error: ${error instanceof Error ? error.message : "Unknown error"}`,
			rules_analysis: [],
			files_summary: [],
			code_blocks: [],
		}
	}
}
