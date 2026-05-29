/**
 * Shared test fixtures for system-prompt tests.
 *
 * This file is intentionally not named `*.test.ts` so that Biome's
 * `noExportsInTest` rule does not flag the exports below. The fixtures
 * are consumed by multiple test files in this directory.
 */

export const mockProviderInfo = {
	providerId: "test",
	model: { id: "fast", info: { supportsPromptCache: false } },
	mode: "act" as const,
}
