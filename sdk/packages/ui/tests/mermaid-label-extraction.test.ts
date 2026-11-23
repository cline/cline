import { describe, expect, test } from "vitest";
import { deriveDiagramLabels } from "../components/mermaid-diagram";

// One case per CodeQL finding on PR #14757 (r4189369628-r4189369709): the input
// shape each flagged regex backtracks on, plus the label count the extraction
// must return for it. A polynomial implementation fails the time bound.
const CASES = [
	{
		build: () => `flowchart LR\n\ta(${"\t b [".repeat(50_000)}!`,
		expectedCount: 0,
		name: "node labels with an unclosed bracket",
	},
	{
		build: () => `flowchart LR\nA[${"<b".repeat(50_000)}] --> B`,
		expectedCount: 1,
		name: "markup stripping over unterminated tags",
	},
	{
		build: () => `flowchart TD\nsubgraph ${"id\t[".repeat(50_000)}Label]`,
		expectedCount: 1,
		name: "subgraph label with repeated bracket prefixes",
	},
	{
		build: () => `flowchart TD\n${"\tsubgraph\t".repeat(50_000)}x`,
		expectedCount: 1,
		name: "subgraph discovery over repeated keywords",
	},
	{
		build: () => `pie title ${"word\t".repeat(50_000)}!`,
		expectedCount: 1,
		name: "diagram title over repeated words",
	},
	{
		build: () => `pie\n${'\ta("'.repeat(50_000)}x`,
		expectedCount: 0,
		name: "generic labels with unclosed quotes",
	},
	{
		build: () => `sequenceDiagram\nactor id as ${"word\t".repeat(50_000)}!`,
		expectedCount: 1,
		name: "sequence participant aliases",
	},
] as const;

describe("diagram label extraction (CodeQL PR #14757 regressions)", () => {
	for (const { build, expectedCount, name } of CASES) {
		test(`${name}: bounded time and correct result`, () => {
			const source = build();
			const start = performance.now();
			const { labels } = deriveDiagramLabels(source);
			expect(performance.now() - start).toBeLessThan(1_000);
			expect(labels).toHaveLength(expectedCount);
		});
	}
});
