import type {
	RuleConfig,
	UserInstructionConfigWatcher,
} from "../../extensions/config/user-instruction-config-loader";

export function isRuleEnabled(rule: RuleConfig): boolean {
	return rule.disabled !== true;
}

export function formatRulesForSystemPrompt(
	rules: ReadonlyArray<RuleConfig>,
): string {
	if (rules.length === 0) {
		return "";
	}

	const renderedRules = rules
		.map((rule) => `## ${rule.name}\n${rule.instructions}`)
		.join("\n\n");
	return `\n\n# Rules\n${renderedRules}`;
}

export function mergeRulesForSystemPrompt(
	primaryRules?: string,
	additionalRules?: string,
): string | undefined {
	const primary = primaryRules?.trim();
	const additional = additionalRules?.trim();
	if (primary && additional) {
		return `${primary}\n\n${additional}`;
	}
	return primary || additional || undefined;
}

export function listEnabledRulesFromWatcher(
	watcher: UserInstructionConfigWatcher,
): RuleConfig[] {
	const snapshot = watcher.getSnapshot("rule");
	return [...snapshot.values()]
		.map((record) => record.item as RuleConfig)
		.filter(isRuleEnabled)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadRulesForSystemPromptFromWatcher(
	watcher: UserInstructionConfigWatcher,
): string {
	return formatRulesForSystemPrompt(listEnabledRulesFromWatcher(watcher));
}
