import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { executeTool, getController, getWorkspaceDirectory, TOOL_DEFINITIONS } from "./delegates"
import { getCheckingWithUserVerificationPrompt } from "./prompts/verify-checking"
import { getCodeStyleVerificationPrompt } from "./prompts/verify-code-style"
import { getPlanningVerificationPrompt } from "./prompts/verify-planning"
import { getSubstepVerificationPrompt } from "./prompts/verify-substep"
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

async function loadGitDiff(): Promise<string> {
	console.log("[verification-engine] Loading git diff")

	try {
		const cwd = getWorkspaceDirectory()

		// Try git diff (works even without HEAD)
		const diff = execSync("git diff", {
			cwd,
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
			timeout: 10000,
		})

		if (!diff || diff.trim().length === 0) {
			return "No git changes detected (working directory is clean)"
		}

		return diff
	} catch (error) {
		console.error("[verification-engine] Error loading git diff:", error)
		return `Error loading git diff: ${error instanceof Error ? error.message : "Unknown error"}`
	}
}

async function loadRelevantFiles(gitDiff: string): Promise<string> {
	console.log("[verification-engine] Loading relevant files")

	try {
		if (!gitDiff || gitDiff.includes("No git changes") || gitDiff.includes("Error")) {
			return "No files to load"
		}

		const cwd = getWorkspaceDirectory()

		const filePathRegex = /^diff --git a\/(.+) b\/(.+)$/gm
		const matches = [...gitDiff.matchAll(filePathRegex)]
		const filePaths = new Set(matches.map((m) => m[2]))

		if (filePaths.size === 0) {
			return "No file paths found in git diff"
		}

		let result = "=== CHANGED FILES ===\n\n"

		for (const filePath of Array.from(filePaths).slice(0, 10)) {
			const fullPath = path.join(cwd, filePath)

			try {
				if (fs.existsSync(fullPath)) {
					const content = fs.readFileSync(fullPath, "utf-8")
					const lines = content.split("\n")
					const preview = lines.slice(0, 50).join("\n")

					result += `--- ${filePath} (${lines.length} lines) ---\n`
					result += preview
					if (lines.length > 50) {
						result += `\n... (${lines.length - 50} more lines)`
					}
					result += "\n\n"
				}
			} catch (err) {
				result += `--- ${filePath} (error reading file) ---\n\n`
			}
		}

		if (filePaths.size > 10) {
			result += `\n(Showing 10 of ${filePaths.size} changed files)\n`
		}

		return result
	} catch (error) {
		console.error("[verification-engine] Error loading files:", error)
		return `Error loading files: ${error instanceof Error ? error.message : "Unknown error"}`
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

		const systemPrompt = "You are a code verification assistant. Use tools to investigate, then provide a final JSON verdict."
		const messages: any[] = [{ role: "user", content: prompt }]

		console.log("[verification-engine] PHASE 1: Investigation (7 iterations max)")

		for (let i = 0; i < 7; i++) {
			console.log(`[verification-engine] Iteration ${i + 1}/7`)

			const stream = api.createMessage(systemPrompt, messages, TOOL_DEFINITIONS)

			let assistantText = ""
			const toolCallsMap = new Map<string, { name: string; args: string }>()
			let thinkingText = ""
			let thinkingSignature: string | undefined

			for await (const chunk of stream) {
				if (chunk.type === "text") {
					assistantText += chunk.text
				}
				if (chunk.type === "tool_calls") {
					const toolCall = chunk.tool_call
					const id = toolCall.function?.id || `tool_${Date.now()}`
					const name = toolCall.function?.name || ""
					const argsChunk = toolCall.function?.arguments || ""

					if (!toolCallsMap.has(id)) {
						console.log("[verification-engine] Tool:", name)
						toolCallsMap.set(id, { name, args: "" })
					}

					toolCallsMap.get(id)!.args += argsChunk
				}
				if (chunk.type === "reasoning") {
					thinkingText += chunk.reasoning || ""
					if (chunk.signature) {
						thinkingSignature = chunk.signature
					}
				}
			}

			const toolCalls = Array.from(toolCallsMap.entries()).map(([id, data]) => ({
				function: { id, name: data.name, arguments: data.args },
			}))

			const assistantContent: any[] = []

			if (thinkingText) {
				const thinkingBlock: any = { type: "thinking", thinking: thinkingText.trim() }
				if (thinkingSignature) {
					thinkingBlock.signature = thinkingSignature
				}
				assistantContent.push(thinkingBlock)
			}

			if (assistantText) {
				assistantContent.push({ type: "text", text: assistantText.trim() })
			}

			for (const toolCall of toolCalls) {
				let toolInput: any = {}
				try {
					toolInput = JSON.parse(toolCall.function?.arguments || "{}")
				} catch {
					continue
				}

				const toolResult = await executeTool(toolCall.function.name, toolInput)

				assistantContent.push({
					type: "tool_use",
					id: toolCall.function.id,
					name: toolCall.function.name,
					input: toolInput,
				})
			}

			// CRITICAL FIX: Anthropic API rejects if last content is a thinking block
			if (assistantContent.length > 0 && assistantContent[assistantContent.length - 1].type === "thinking") {
				assistantContent.push({ type: "text", text: "." })
			}

			if (assistantContent.length > 0) {
				messages.push({ role: "assistant", content: assistantContent })
			}

			for (const toolCall of toolCalls) {
				let toolInput: any = {}
				try {
					toolInput = JSON.parse(toolCall.function?.arguments || "{}")
				} catch {
					continue
				}

				const toolResult = await executeTool(toolCall.function.name, toolInput)

				messages.push({
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: toolCall.function.id,
							content: toolResult,
						},
					],
				})
			}

			if (toolCalls.length === 0) {
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
			content: schemaPrompt,
		})

		const verdictStream = api.createMessage(systemPrompt, messages, [])

		let verdictText = ""
		for await (const chunk of verdictStream) {
			if (chunk.type === "text") {
				verdictText += chunk.text
			}
		}

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
