import type { ActiveRulesMetadataEntry } from "./ContextTrackerTypes"

interface ActivatedConditionalRule {
	name: string
	matchedConditions: Record<string, string[]>
}

/**
 * Filter enabled rule paths from a toggles map.
 * Rules default to enabled — only entries explicitly set to false are excluded.
 */
function getEnabledRulePaths(toggles: Record<string, boolean>): string[] {
	return Object.entries(toggles)
		.filter(([, enabled]) => enabled !== false)
		.map(([filePath]) => filePath)
}

/**
 * Build an ActiveRulesMetadataEntry from the current rule toggles and activated conditional rules.
 */
export function buildActiveRulesMetadata(params: {
	globalToggles: Record<string, boolean>
	localToggles: Record<string, boolean>
	cursorLocalToggles: Record<string, boolean>
	windsurfLocalToggles: Record<string, boolean>
	agentsLocalToggles: Record<string, boolean>
	activatedConditionalRules: ActivatedConditionalRule[]
}): ActiveRulesMetadataEntry {
	return {
		ts: Date.now(),
		global: getEnabledRulePaths(params.globalToggles),
		local: getEnabledRulePaths(params.localToggles),
		cursor: getEnabledRulePaths(params.cursorLocalToggles),
		windsurf: getEnabledRulePaths(params.windsurfLocalToggles),
		agents: getEnabledRulePaths(params.agentsLocalToggles),
		activated_conditional_rules: params.activatedConditionalRules.map((rule) => ({
			name: rule.name,
			matched_conditions: rule.matchedConditions,
		})),
	}
}
