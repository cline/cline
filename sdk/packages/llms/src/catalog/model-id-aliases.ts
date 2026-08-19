export interface ModelIdAliasRule {
	canonicalPrefix: string;
	aliasPrefix: string;
}

// Some upstream catalogs expose the same routed model under different provider
// namespaces. Prefer the namespace our runtime can receive so exact model-info
// lookups keep the right context window and token limits.
export const VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES = [
	{ canonicalPrefix: "zai/", aliasPrefix: "z-ai/" },
] as const satisfies readonly ModelIdAliasRule[];

export function isCanonicalModelIdForAliasRules(
	modelId: string,
	rules: readonly ModelIdAliasRule[],
): boolean {
	return rules.some((rule) => modelId.startsWith(rule.canonicalPrefix));
}

export function preferCanonicalModelIds<T>(
	models: Record<string, T>,
	rules: readonly ModelIdAliasRule[],
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(models).filter(([modelId]) => {
			for (const rule of rules) {
				if (!modelId.startsWith(rule.aliasPrefix)) continue;
				const canonicalModelId = `${rule.canonicalPrefix}${modelId.slice(rule.aliasPrefix.length)}`;
				if (canonicalModelId in models) return false;
			}
			return true;
		}),
	);
}
