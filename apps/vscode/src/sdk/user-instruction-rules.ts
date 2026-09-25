import { formatRulesForSystemPrompt, isRuleEnabled, type RuleConfig, type UserInstructionConfigService } from "@cline/core"

/**
 * Render the user's enabled rules (`.clinerules`, global rules, remote-config
 * rules) the way the SDK renders them into a session's system prompt.
 *
 * Standalone utility callers (commit message generation) have no session, so
 * they don't get the SDK's rules extension for free. Routing them through the
 * same watcher snapshot and the same `formatRulesForSystemPrompt` /
 * `isRuleEnabled` helpers keeps one source of truth for which rules the model
 * sees and how they are phrased — a rule toggled off in the UI (persisted as
 * `disabled` frontmatter) disappears from both paths at once.
 *
 * Returns an empty string when no enabled rule exists.
 */
export function renderEnabledRulesForSystemPrompt(service: Pick<UserInstructionConfigService, "listRecords">): string {
	const rules = service
		.listRecords<RuleConfig>("rule")
		.map((record) => record.item)
		.filter(isRuleEnabled)
		.sort((a, b) => a.name.localeCompare(b.name))
	return formatRulesForSystemPrompt(rules)
}
