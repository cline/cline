import { executeThroughCline, loadChatHistory, runFinalVerdict } from "./cline-execution"
import { getSubstepVerificationPrompt } from "./prompts/verify-substep"
import { getVerifySubstepRequirementsPrompt } from "./prompts/verify-substep-requirements"
import { EnforcementRequest, EnforcementResponse, RequirementVerificationsResponse } from "./types"
import { stripMarkdownJson } from "./utils"

const VERIFY_SUBSTEP_SYSTEM_PROMPT = "You are a code verification assistant. Use tools to investigate that the substep was completed properly."
const VERIFY_REQUIREMENTS_SYSTEM_PROMPT = "You are a requirements verification assistant. Use tools to investigate if each requirement is satisfied."
const VERIFY_STEP_SYSTEM_PROMPT = "You are a step verification assistant. Use tools to investigate if the step was completed properly."
const VERIFY_SUBSTEP_SCHEMA_PROMPT = `Based on your investigation above, return ONLY valid JSON:

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
const VERIFY_STEP_SCHEMA_PROMPT = `Based on your investigation above, return ONLY valid JSON:

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

export async function verifySubstep(request: EnforcementRequest): Promise<EnforcementResponse> {
    console.log("[verify-engine] verifySubstep called for substep:", request.substep_id)

    // Find the specific substep
    const substep = request.node?.substeps?.find((s) => s.id === request.substep_id)
    if (!substep) {
        console.error("[verify-engine] Substep not found:", request.substep_id)
        return {
            verdict: "unclear",
            overview: `## Substep Not Found\n- Requested: ${request.substep_id}\n- Available: ${request.node?.substeps?.map((s) => s.id).join(", ") || "none"}`,
            rules_analysis: [],
            files_summary: [],
            code_blocks: [],
        }
    }

    console.log("[verify-engine] Verifying substep:", substep.id, "-", substep.text)

    try {
        // Verify this substep - now returns same rich EnforcementResponse as steps
        const verification = await runSubstepVerification(
            request.chat_id,
            request.node?.description || "",
            substep.text,
            substep.id,
            request.node?.rules || [],
        )

        console.log("[verify-engine] Substep verification complete:", substep.id)

        // Return the rich verification response directly
        return verification
    } catch (error) {
        console.error("[verify-engine] Substep verification error:", error)
        return {
            verdict: "unclear",
            overview: `## Verification Failed\n- Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            rules_analysis: [],
            files_summary: [],
            code_blocks: [],
        }
    }
}

export async function runSubstepVerification(
    chatId: string,
    stepDescription: string,
    substepDescription: string,
    substepId: string,
    rules: Array<{ rule_id: string; name: string; description: string }>,
): Promise<EnforcementResponse> {
    console.log("[verify-engine] 🔍 Verifying substep:", substepId)

    try {
        // Load chat history only - let Cline use tools to investigate files
        const chatHistory = await loadChatHistory(chatId)

        // Build substep-specific prompt (no preloaded git diff/files)
        const prompt = getSubstepVerificationPrompt(stepDescription, substepDescription, rules, chatHistory)

        // Use callLLM with 'substep' type - now returns same rich schema as steps
        console.log("[verify-engine] PHASE 1: Research changes")
        let messages = await executeThroughCline(prompt, VERIFY_SUBSTEP_SYSTEM_PROMPT, 7)
        console.log("[execution-engine] PHASE 2: Return final verdict")
        let verdict = await runFinalVerdict(messages, VERIFY_SUBSTEP_SCHEMA_PROMPT, VERIFY_SUBSTEP_SYSTEM_PROMPT)

        // Use same parser as steps - returns VerifyResult/EnforcementResponse
        const parsed = parseVerificationResponse(verdict)

        return parsed
    } catch (error) {
        console.error("[verify-engine] Substep verification error:", error)
        return {
            verdict: "unclear",
            overview: `## Substep Verification Failed\n- Substep: ${substepDescription}\n- Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            rules_analysis: [],
            files_summary: [],
            code_blocks: [],
        }
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
        console.error("[verify-engine] JSON parse error:", error)
        return {
            verdict: "unclear",
            overview: `## Parse Error\n- Failed to parse LLM response\n- Response: ${llmResponse.substring(0, 200)}...`,
            rules_analysis: [],
            files_summary: [],
            code_blocks: [],
        }
    }
}

export async function verifySubstepRequirements(
    chatId: string,
    stepDescription: string,
    substepDescription: string,
    requirements: Array<{ id: string; description: string; category: string; source: string }>,
): Promise<RequirementVerificationsResponse> {
    console.log("[verify-engine] 📋 Verifying", requirements.length, "requirements for substep")

    try {
        // Load chat history
        const chatHistory = await loadChatHistory(chatId)

        // Build prompt with ALL requirements
        const prompt = getVerifySubstepRequirementsPrompt(
            stepDescription,
            substepDescription,
            requirements,
            chatHistory
        )

        // PHASE 1: Investigation (7 iterations, same as verifySubstep)
        console.log("[verify-engine] PHASE 1: Investigating requirements")
        const messages = await executeThroughCline(prompt, VERIFY_REQUIREMENTS_SYSTEM_PROMPT, 7)

        // PHASE 2: Get verdict for ALL requirements at once
        console.log("[verify-engine] PHASE 2: Generating requirement verifications")
        const schemaPrompt = `Based on your investigation above, return ONLY valid JSON array with verification for EACH requirement:

[
  {
    "requirement_id": "req-1",
    "verdict": "pass" | "fail" | "unclear",
    "evidence": "Detailed evidence with code snippets showing this requirement is satisfied. Include file paths, line numbers, and specific code examples.",
    "files_changed": [
      {
        "path": "path/to/file.ts",
        "lines_changed": "45-50, 120-135",
        "changes": "What changed in this file",
        "impact": "Why this change matters for this requirement",
        "substeps_fulfilled": []
      }
    ],
    "code_changed": [
      {
        "file": "path/to/file.ts",
        "lines": "125-130",
        "code": "actual code snippet",
        "annotation": "How this code satisfies the requirement"
      }
    ]
  }
]

Return the complete JSON array for ALL ${requirements.length} requirements.`

        const verdict = await runFinalVerdict(messages, schemaPrompt, VERIFY_REQUIREMENTS_SYSTEM_PROMPT)

        // Parse JSON response
        const cleaned = stripMarkdownJson(verdict)
        const verifications = JSON.parse(cleaned)

        console.log(`[verify-engine] ✅ Verified ${verifications.length} requirements`)

        return {
            success: true,
            verifications,
        }
    } catch (error) {
        console.error("[verify-engine] Requirements verification error:", error)
        return {
            success: false,
            verifications: [],
            error: error instanceof Error ? error.message : "Unknown error",
        }
    }
}

export async function verifyStep(
    chatId: string,
    nodeId: string,
    node: {
        type: "checking-with-user" | "planning" | "code-style"
        description: string
        rules: Array<{ rule_id: string; name: string; description: string }>
        substeps?: Array<{ id: string; text: string; completed: boolean }>
    },
): Promise<EnforcementResponse> {
    console.log("[verify-engine] 🔍 Verifying step:", nodeId, "- Type:", node.type)

    try {
        // Load chat history
        const chatHistory = await loadChatHistory(chatId)

        // Import prompts dynamically to avoid formatter issues
        const { getPlanningVerificationPrompt } = await import("./prompts/verify-planning")
        const { getCheckingWithUserVerificationPrompt } = await import("./prompts/verify-checking")
        const { getCodeStyleVerificationPrompt } = await import("./prompts/verify-code-style")

        // Build prompt based on node type
        let prompt: string
        let schemaPrompt: string

        if (node.type === "planning") {
            prompt = getPlanningVerificationPrompt(node.description, node.rules, chatHistory, "")
            schemaPrompt = VERIFY_STEP_SCHEMA_PROMPT
        } else if (node.type === "checking-with-user") {
            prompt = getCheckingWithUserVerificationPrompt(node.description, node.rules, chatHistory)
            schemaPrompt = VERIFY_STEP_SCHEMA_PROMPT
        } else {
            // code-style
            prompt = getCodeStyleVerificationPrompt(
                node.description,
                node.substeps || [],
                node.rules,
                chatHistory
            )
            schemaPrompt = VERIFY_SUBSTEP_SCHEMA_PROMPT // Use rich schema for code-style
        }

        // PHASE 1: Investigation (7 iterations)
        console.log("[verify-engine] PHASE 1: Investigating step")
        const messages = await executeThroughCline(prompt, VERIFY_STEP_SYSTEM_PROMPT, 7)

        // PHASE 2: Get verdict
        console.log("[verify-engine] PHASE 2: Generating step verdict")
        const verdict = await runFinalVerdict(messages, schemaPrompt, VERIFY_STEP_SYSTEM_PROMPT)

        // Parse response
        const parsed = parseVerificationResponse(verdict)

        console.log(`[verify-engine] ✅ Step verification complete: ${parsed.verdict}`)

        return parsed
    } catch (error) {
        console.error("[verify-engine] Step verification error:", error)
        return {
            verdict: "unclear",
            overview: `## Step Verification Failed\n- Step: ${node.description}\n- Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            rules_analysis: [],
            files_summary: [],
            code_blocks: [],
        }
    }
}
