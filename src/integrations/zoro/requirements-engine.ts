import { executeThroughCline, runFinalVerdict } from "./cline-execution"
import { getGenerateSubstepRequirementsPrompt } from "./prompts/generate-requirements"
import { Requirement, RequirementsResponse } from "./types"
import { stripMarkdownJson } from "./utils"

const REQUIREMENTS_SYSTEM_PROMPT =
	"You are a requirements generation assistant. Investigate the codebase to generate specific, testable requirements FOR ONLY THIS SUBSTEP in JSON format."

/**
 * Generates requirements for a substep by investigating the codebase first
 * Uses 2-phase approach: investigation → JSON generation
 */
export async function generateRequirements(
	stepDescription: string,
	substepDescription: string,
	rules: Array<{ rule_id: string; name: string; description: string }>,
): Promise<RequirementsResponse> {
	try {
		console.log("[requirements-engine] 📋 Starting requirements generation")
		console.log("[requirements-engine] Step:", stepDescription)
		console.log("[requirements-engine] Substep:", substepDescription)

		// Build investigation prompt
		const prompt = getGenerateSubstepRequirementsPrompt(stepDescription, substepDescription, rules)

		// PHASE 1: Investigation (5 iterations with tools to explore codebase)
		console.log("[requirements-engine] PHASE 1: Investigation (5 iterations)")
		const messages = await executeThroughCline(prompt, REQUIREMENTS_SYSTEM_PROMPT, 5)

		console.log("[requirements-engine] Investigation complete, collected context")

		// PHASE 2: Generate final requirements JSON based on investigation
		console.log("[requirements-engine] PHASE 2: Generating structured requirements")
		const schemaPrompt = `Based on your investigation above, generate the requirements checklist now.

Return ONLY valid JSON matching this format (no markdown, no explanation):

[
  {
    "description": "Specific, testable requirement",
    "category": "feature"
  },
  {
    "description": "Another requirement",
    "category": "rule"
  }
]

Generate the requirements array now:`

		const response = await runFinalVerdict(messages, schemaPrompt, REQUIREMENTS_SYSTEM_PROMPT)

		// Parse JSON response
		console.log("[requirements-engine] Parsing requirements JSON")
		const cleaned = stripMarkdownJson(response)
		const requirements: Requirement[] = JSON.parse(cleaned)

		console.log(`[requirements-engine] ✅ Generated ${requirements.length} requirements`)

		return {
			success: true,
			requirements,
		}
	} catch (error) {
		console.error("[requirements-engine] Error generating requirements:", error)
		return {
			success: false,
			requirements: [],
			error: error instanceof Error ? error.message : "Unknown error",
		}
	}
}