// @vitest-environment jsdom
//
// `@cline/ui` keeps its tests in this package-level `tests/` directory (see
// `vitest.config.ts`'s `include`), unlike the product webviews, which colocate
// test files beside their source. jsdom is requested per-file because the
// package default is `node`; that default exercises the pattern-based fallback
// in `markdown-mermaid.test.ts`, while this file covers the DOM parser path.
import { describe, expect, test } from "vitest";
import {
	DIAGRAM_LINK_HREF_ATTRIBUTE,
	neutralizeDiagramLinks,
} from "../components/markdown";

/**
 * Captured from Mermaid 11.16.1 rendering, under `securityLevel: "strict"`:
 *
 *   flowchart LR
 *     A[Official Cline Docs] --> B[End]
 *     click A "https://evil.example.com/harvest?t=1"
 *
 * Strict mode blocks scripts and dangerous schemes but still emits a live
 * `<a xlink:href>` for an http(s) `click` directive, with no target and no rel.
 */
const RENDERED_DIAGRAM = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="d1" viewBox="0 0 240 80"><g class="nodes"><a xlink:href="https://evil.example.com/harvest?t=1" data-look="classic" transform="translate(119.87890625, 35)"><g class="node default clickable"><text>Official Cline Docs</text></g></a></g></svg>`;

describe("neutralizeDiagramLinks (DOM parser path)", () => {
	test("strips the navigable href from a rendered diagram link", () => {
		const sanitized = neutralizeDiagramLinks(RENDERED_DIAGRAM);

		expect(sanitized).not.toContain("xlink:href");
		expect(sanitized).not.toMatch(/\shref\s*=/);
		expect(sanitized).toContain(
			`${DIAGRAM_LINK_HREF_ATTRIBUTE}="https://evil.example.com/harvest?t=1"`,
		);
		// The diagram itself must survive intact.
		expect(sanitized).toContain("Official Cline Docs");
	});

	test("leaves the anchor unable to navigate once parsed back into the DOM", () => {
		const host = document.createElement("div");
		host.innerHTML = neutralizeDiagramLinks(RENDERED_DIAGRAM);
		const anchor = host.querySelector("a");

		expect(anchor).not.toBeNull();
		expect(anchor?.getAttribute("xlink:href")).toBeNull();
		expect(anchor?.getAttribute("href")).toBeNull();
		expect(anchor?.getAttribute(DIAGRAM_LINK_HREF_ATTRIBUTE)).toBe(
			"https://evil.example.com/harvest?t=1",
		);
	});

	test("drops a target attribute rather than preserving it", () => {
		const withTarget = RENDERED_DIAGRAM.replace(
			"data-look=",
			'target="_blank" data-look=',
		);

		expect(neutralizeDiagramLinks(withTarget)).not.toContain("target=");
	});

	test.each([
		["javascript:alert(1)"],
		["data:text/html,<h1>x</h1>"],
		["file:///etc/passwd"],
		["vbscript:msgbox(1)"],
	])("does not preserve a non-http(s) destination (%s)", (destination) => {
		const hostile = RENDERED_DIAGRAM.replace(
			"https://evil.example.com/harvest?t=1",
			destination,
		);
		const sanitized = neutralizeDiagramLinks(hostile);

		// Mermaid strict mode already strips these, but the host must not
		// re-expose one if a renderer upgrade ever lets it through.
		expect(sanitized).not.toContain(DIAGRAM_LINK_HREF_ATTRIBUTE);
		expect(sanitized.toLowerCase()).not.toContain("javascript:");
		expect(sanitized.toLowerCase()).not.toContain("vbscript:");
	});

	test("neutralizes every anchor when a diagram carries several", () => {
		const many = RENDERED_DIAGRAM.replace(
			"</g></svg>",
			'<a xlink:href="https://second.example.com/">' +
				"<g><text>Second</text></g></a></g></svg>",
		);
		const sanitized = neutralizeDiagramLinks(many);

		expect(sanitized).not.toContain("xlink:href");
		expect(sanitized).toContain("https://second.example.com/");
		expect(sanitized).toContain("https://evil.example.com/harvest?t=1");
	});

	test("passes through a diagram with no links untouched", () => {
		const plain =
			'<svg xmlns="http://www.w3.org/2000/svg"><text>No links</text></svg>';

		expect(neutralizeDiagramLinks(plain)).toBe(plain);
	});
});
