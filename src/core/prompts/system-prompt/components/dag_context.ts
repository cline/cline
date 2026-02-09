/**
 * DAG Context Component
 *
 * Provides dependency graph awareness to the system prompt when DAG analysis is enabled.
 * This helps the agent understand cross-file dependencies and avoid breaking changes.
 */

import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const DAG_CONTEXT_TEMPLATE = `DEPENDENCY AWARENESS

You have access to a dependency graph (DAG) that tracks relationships between files and functions in this codebase. Use this information to:

1. **Understand Impact**: Before modifying a function or file, consider what other code depends on it. Changes to widely-used functions require extra care.

2. **Avoid Breaking Changes**: When changing function signatures, return types, or behavior:
   - Check for callers that may be affected
   - Update all affected call sites
   - Consider backward compatibility

3. **Prioritize Testing**: The dependency graph suggests which tests are most relevant to your changes. Run these tests to verify you haven't broken anything.

4. **Confidence Levels**: Dependencies have confidence scores:
   - HIGH: Statically verified, very reliable
   - MEDIUM: Likely correct but involves some inference
   - LOW: Possible relationship, verify manually
   - UNSAFE: Dynamic import/reflection, cannot be statically verified

When the DAG analysis identifies impacted files or functions, they will be included in the context. Pay special attention to:
- Files with many dependents (high fan-in)
- Core utility functions used across the codebase
- Interface/type definitions that others implement

{{DAG_IMPACT_CONTEXT}}`

const DAG_IMPACT_TEMPLATE = `
Current Impact Analysis:
{{IMPACT_DETAILS}}`

export async function getDagContextSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	// Only include DAG context if enabled
	if (!context.dagEnabled) {
		return ""
	}

	const template = variant.componentOverrides?.[SystemPromptSection.DAG_CONTEXT]?.template || DAG_CONTEXT_TEMPLATE

	// Build impact context if available
	let dagImpactContext = ""
	if (context.dagImpact) {
		const impact = context.dagImpact
		const impactDetails: string[] = []

		if (impact.affectedFiles && impact.affectedFiles.length > 0) {
			impactDetails.push(
				`- Affected files: ${impact.affectedFiles.slice(0, 10).join(", ")}${impact.affectedFiles.length > 10 ? ` (+${impact.affectedFiles.length - 10} more)` : ""}`,
			)
		}

		if (impact.affectedFunctions && impact.affectedFunctions.length > 0) {
			impactDetails.push(
				`- Affected functions: ${impact.affectedFunctions.slice(0, 10).join(", ")}${impact.affectedFunctions.length > 10 ? ` (+${impact.affectedFunctions.length - 10} more)` : ""}`,
			)
		}

		if (impact.suggestedTests && impact.suggestedTests.length > 0) {
			impactDetails.push(`- Suggested tests: ${impact.suggestedTests.slice(0, 5).join(", ")}`)
		}

		if (impact.confidenceBreakdown) {
			const cb = impact.confidenceBreakdown
			impactDetails.push(
				`- Edge confidence: ${cb.high || 0} high, ${cb.medium || 0} medium, ${cb.low || 0} low, ${cb.unsafe || 0} unsafe`,
			)
		}

		if (impactDetails.length > 0) {
			const impactEngine = new TemplateEngine()
			dagImpactContext = impactEngine.resolve(DAG_IMPACT_TEMPLATE, context, {
				IMPACT_DETAILS: impactDetails.join("\n"),
			})
		}
	}

	const templateEngine = new TemplateEngine()
	return templateEngine.resolve(template, context, {
		DAG_IMPACT_CONTEXT: dagImpactContext,
	})
}
