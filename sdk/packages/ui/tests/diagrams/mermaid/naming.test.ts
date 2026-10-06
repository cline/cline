// Exercises the naming module (slugs, fence/frontmatter titles, filenames) of
// `components/diagrams/mermaid/` via the public façade.

import { describe, expect, test } from "vitest";
import {
	diagramFileName,
	MAX_DIAGRAM_SLUG_LENGTH,
	normalizeDiagramSource,
	parseFenceTitle,
	parseFrontmatterTitle,
	slugifyDiagramName,
	splitFrontmatter,
} from "../../../components/mermaid-diagram";

const FLOW = "flowchart LR\nA --> B";

describe("slugifyDiagramName", () => {
	test("lowercases and keeps only alphanumerics and single hyphens", () => {
		expect(slugifyDiagramName("App Infrastructure_Architecture!")).toBe(
			"app-infrastructure-architecture",
		);
		expect(slugifyDiagramName("  --Hello   World--  ")).toBe("hello-world");
		expect(slugifyDiagramName("Café déjà vu")).toBe("cafe-deja-vu");
		expect(slugifyDiagramName("../../etc/passwd")).toBe("etc-passwd");
	});

	test("returns an empty string when nothing usable remains", () => {
		expect(slugifyDiagramName("")).toBe("");
		expect(slugifyDiagramName("!!! ???")).toBe("");
	});

	test("caps length without leaving a trailing hyphen", () => {
		const slug = slugifyDiagramName(`${"a".repeat(63)} bbbb`);
		expect(slug.length).toBeLessThanOrEqual(MAX_DIAGRAM_SLUG_LENGTH);
		expect(slug.endsWith("-")).toBe(false);
		expect(slugifyDiagramName("x".repeat(500)).length).toBe(
			MAX_DIAGRAM_SLUG_LENGTH,
		);
	});
});

describe("parseFenceTitle", () => {
	test.each([
		[
			'title="app-infrastructure-architecture"',
			"app-infrastructure-architecture",
		],
		["title='Single Quoted'", "Single Quoted"],
		["title=\u201cCurly Quoted\u201d", "Curly Quoted"],
		["title=unquoted-name", "unquoted-name"],
		['title: "colon form"', "colon form"],
		['{1,3} title="with other meta" showLineNumbers', "with other meta"],
		['showLineNumbers title="after flag"', "after flag"],
		['TITLE="Upper"', "Upper"],
	])("reads %s", (meta, expected) => {
		expect(parseFenceTitle(meta)).toBe(expected);
	});

	test("tolerates a title whose closing quote has not streamed in yet", () => {
		expect(parseFenceTitle('title="partial-na')).toBe("partial-na");
	});

	test("returns undefined for missing, empty, or title-less metadata", () => {
		expect(parseFenceTitle(undefined)).toBeUndefined();
		expect(parseFenceTitle(null)).toBeUndefined();
		expect(parseFenceTitle("")).toBeUndefined();
		expect(parseFenceTitle("   ")).toBeUndefined();
		expect(parseFenceTitle('title=""')).toBeUndefined();
		expect(parseFenceTitle("{1,3} showLineNumbers")).toBeUndefined();
		expect(parseFenceTitle('subtitle="nope"')).toBeUndefined();
	});
});

describe("frontmatter", () => {
	test("splits a leading frontmatter block off the diagram body", () => {
		const source = `---\ntitle: Auth Flow\nconfig:\n  theme: dark\n---\n${FLOW}`;
		expect(splitFrontmatter(source)).toEqual({
			body: FLOW,
			frontmatter: "title: Auth Flow\nconfig:\n  theme: dark",
		});
		expect(splitFrontmatter(FLOW)).toEqual({
			body: FLOW,
			frontmatter: undefined,
		});
	});

	test("reads a top-level title, unquoting it, and ignores nested ones", () => {
		expect(parseFrontmatterTitle(`---\ntitle: Auth Flow\n---\n${FLOW}`)).toBe(
			"Auth Flow",
		);
		expect(
			parseFrontmatterTitle(`---\ntitle: "Quoted: Title"\n---\n${FLOW}`),
		).toBe("Quoted: Title");
		expect(
			parseFrontmatterTitle(`---\nconfig:\n  title: nested\n---\n${FLOW}`),
		).toBeUndefined();
		expect(parseFrontmatterTitle(FLOW)).toBeUndefined();
		// An unclosed block (still streaming) is not frontmatter yet.
		expect(parseFrontmatterTitle("---\ntitle: Half")).toBeUndefined();
	});
});

describe("diagram file helpers", () => {
	test("builds .mmd and .png names", () => {
		expect(diagramFileName("my-diagram", "mmd")).toBe("my-diagram.mmd");
		expect(diagramFileName("my-diagram", "png")).toBe("my-diagram.png");
		expect(diagramFileName("", "png")).toBe("diagram.png");
	});

	test("normalizes trailing whitespace to a single newline", () => {
		expect(normalizeDiagramSource("a --> b\n\n  \n")).toBe("a --> b\n");
	});
});
