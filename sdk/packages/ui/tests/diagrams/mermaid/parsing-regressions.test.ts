// Regression cases for Mermaid source parsing across the diagram modules,
// exercised via the public façade.

import { describe, expect, test } from "vitest";
import {
	cssColorToHex,
	deriveDiagramLabels,
	normalizeDiagramSource,
	parseCssColor,
	parseFenceTitle,
	parseFrontmatterTitle,
	prepareSvgForRaster,
} from "../../../components/mermaid-diagram";

const FLOW = "flowchart LR\nA --> B";

describe("Mermaid parsing regression cases", () => {
	test.each([
		['title=plain title="Quoted"', "Quoted"],
		['title= title="Quoted"', "Quoted"],
		['title="unfinished title=plain', "plain"],
		['title="unfinished title=“curly', "unfinished title=“curly"],
		["title=“unfinished title=“curly", "unfinished title=“curly"],
		['title="" title=plain', undefined],
		['title="unfinished title=“closed”', "closed"],
		["title = \t 'Spaced'", "Spaced"],
	])("preserves title precedence for %s", (meta, expected) => {
		expect(parseFenceTitle(meta)).toBe(expected);
	});

	test("trims frontmatter titles without consuming the next line", () => {
		expect(
			parseFrontmatterTitle(`---\ntitle\t: \t'Auth Flow'\t\r\n---\n${FLOW}`),
		).toBe("Auth Flow");
		expect(
			parseFrontmatterTitle(`---\ntitle: \t\nconfig: dark\n---\n${FLOW}`),
		).toBeUndefined();
		expect(
			parseFrontmatterTitle(`---\ntitle:\ntitle: Second\n---\n${FLOW}`),
		).toBe("Second");
	});

	test("removes multiple and multiline directives without dropping diagram content", () => {
		expect(
			deriveDiagramLabels(
				'%%{init:\n{"theme":"dark"}}%%flowchart LR\n%%{init: {}}%%A[Client] --> B[Server]',
			),
		).toEqual({
			labels: ["Client", "Server"],
			type: "flowchart",
		});
		expect(
			deriveDiagramLabels("flowchart LR\n%%{unfinished\nA[Client]"),
		).toEqual({
			labels: ["Client"],
			type: "flowchart",
		});
	});

	test("preserves interior whitespace and trims Unicode trailing whitespace", () => {
		expect(normalizeDiagramSource(" \tA\tB\u00a0\uFEFF\r\n")).toBe(" \tA\tB\n");
	});

	test("parses padded CSS color arguments and rejects unfinished functions", () => {
		expect(cssColorToHex("rgb( \t255 0 0 \t)")).toBe("#ff0000");
		expect(parseCssColor("rgb( \t255 0 0")).toBeNull();
	});

	test("preserves unrelated SVG styles and removes case-insensitive max-width styles", () => {
		expect(prepareSvgForRaster('<svg style="fill: red"></svg>').svg).toContain(
			'style="fill: red"',
		);
		expect(
			prepareSvgForRaster('<svg STYLE="MAX-WIDTH: 100px; fill: red"></svg>')
				.svg,
		).not.toContain("STYLE=");
		expect(prepareSvgForRaster('<svg style="max-width></svg>').svg).toContain(
			'style="max-width>',
		);
	});

	// CodeQL's adversarial shapes: repeated failed matches must not rescan suffixes.
	test.each([
		[
			"fence titles",
			() => {
				const suffix = "\ttitle:“!".repeat(20_000);
				expect(parseFenceTitle(`\ttitle:"${suffix}`)).toBe(suffix.trim());
			},
		],
		[
			"frontmatter whitespace",
			() => {
				const padding = "\t".repeat(20_000);
				expect(
					parseFrontmatterTitle(`---\ntitle:${padding}\n---\n${FLOW}`),
				).toBeUndefined();
				expect(
					parseFrontmatterTitle(`---\ntitle:a${padding}\n---\n${FLOW}`),
				).toBe("a");
			},
		],
		[
			"unterminated directives",
			() => {
				expect(
					deriveDiagramLabels(`${"%%{{".repeat(20_000)}\n${FLOW}`),
				).toEqual({ labels: [], type: "flowchart" });
			},
		],
		[
			"interior whitespace",
			() => {
				const source = `${"\t".repeat(20_000)}!`;
				expect(normalizeDiagramSource(source)).toBe(`${source}\n`);
			},
		],
		[
			"unfinished CSS functions",
			() => {
				expect(parseCssColor(`-(${"\t".repeat(20_000)}!`)).toBeNull();
			},
		],
		[
			"unterminated SVG styles",
			() => {
				const style = `style="${"max-width".repeat(20_000)}`;
				expect(prepareSvgForRaster(`<svg ${style}></svg>`).svg).toContain(
					style,
				);
			},
		],
	])("processes %s without polynomial backtracking", (_name, check) => {
		const start = performance.now();
		check();
		expect(performance.now() - start).toBeLessThan(1_000);
	});
});
