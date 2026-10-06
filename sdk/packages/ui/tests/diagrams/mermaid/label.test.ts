// Exercises the label module (diagram type detection, label extraction, slug
// resolution) of `components/diagrams/mermaid/` via the public façade,
// including the CodeQL PR #14757 backtracking regressions.

import { describe, expect, test } from "vitest";
import {
	DEFAULT_DIAGRAM_NAME,
	deriveDiagramLabels,
	resolveDiagramSlug,
} from "../../../components/mermaid-diagram";

const FLOW = "flowchart LR\nA --> B";

describe("deriveDiagramLabels", () => {
	test("uses the first subgraph then node labels for flowcharts", () => {
		expect(
			deriveDiagramLabels(
				"flowchart TD\n  subgraph VPC\n    GW[API Gateway] --> S[Service]\n  end",
			),
		).toEqual({ labels: ["VPC", "API Gateway"], type: "flowchart" });
		expect(deriveDiagramLabels("graph LR\n  A[Client] --> B{Router}")).toEqual({
			labels: ["Client", "Router"],
			type: "flowchart",
		});
	});

	test("handles quoted subgraph titles and skips directives and comments", () => {
		const source =
			'%%{init: {"theme":"dark"}}%%\n%% a comment\nflowchart LR\n  subgraph sg1 ["Data Plane"]\n    A[Foo]\n  end';
		expect(deriveDiagramLabels(source)).toEqual({
			labels: ["Data Plane", "Foo"],
			type: "flowchart",
		});
	});

	test("names other diagram families", () => {
		expect(
			deriveDiagramLabels(
				"sequenceDiagram\n participant U as User\n participant API\n U->>API: hi",
			),
		).toEqual({ labels: ["User", "API"], type: "sequence" });
		expect(
			deriveDiagramLabels("erDiagram\n CUSTOMER ||--o{ ORDER : places"),
		).toEqual({ labels: ["CUSTOMER", "ORDER"], type: "er" });
		expect(deriveDiagramLabels('pie title Pets\n "Dogs" : 3').type).toBe("pie");
	});

	test("never throws on empty or malformed input", () => {
		expect(deriveDiagramLabels("")).toEqual({ labels: [], type: "" });
		expect(deriveDiagramLabels("flowchart LR\nA --")).toEqual({
			labels: [],
			type: "flowchart",
		});
		expect(() => deriveDiagramLabels("[[[ ((( ---\n%%{")).not.toThrow();
	});
});

describe("resolveDiagramSlug", () => {
	test("prefers the fence title over everything else", () => {
		expect(
			resolveDiagramSlug({
				meta: 'title="app-infrastructure-architecture"',
				source: `---\ntitle: Ignored\n---\n${FLOW}`,
			}),
		).toBe("app-infrastructure-architecture");
	});

	test("falls back to frontmatter, then derived labels, then `diagram`", () => {
		expect(
			resolveDiagramSlug({
				meta: undefined,
				source: `---\ntitle: Auth Flow\n---\n${FLOW}`,
			}),
		).toBe("auth-flow");
		expect(
			resolveDiagramSlug({
				meta: "",
				source:
					"flowchart TD\n  subgraph VPC\n    GW[API Gateway] --> S[Service]\n  end",
			}),
		).toBe("flowchart-vpc-api-gateway");
		expect(resolveDiagramSlug({ source: "" })).toBe(DEFAULT_DIAGRAM_NAME);
	});

	test("skips a fence title that slugifies to nothing", () => {
		expect(resolveDiagramSlug({ meta: 'title="!!!"', source: FLOW })).toBe(
			"flowchart",
		);
	});

	test("keeps derived names short", () => {
		const long = `flowchart LR\n  subgraph ${"Very".repeat(30)}\n  end`;
		expect(resolveDiagramSlug({ source: long }).length).toBeLessThanOrEqual(48);
	});
});

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
