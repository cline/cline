// Shared provider info fixture used across the system-prompt test suite.
// Kept in a non-`.test.ts` file (like matcher-test.ts) so it can be exported
// and imported by sibling test files without tripping biome's noExportsInTest rule.
export const mockProviderInfo = {
	providerId: "test",
	model: { id: "fast", info: { supportsPromptCache: false } },
	mode: "act" as const,
}
