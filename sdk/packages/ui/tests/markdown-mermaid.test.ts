import { describe, expect, test, vi } from "vitest";
import {
	agentMarkdownControls,
	agentMarkdownControlsWithMermaid,
	buildMermaidConfig,
	createLazyMermaidPlugin,
	DEFAULT_MERMAID_CONFIG,
	DIAGRAM_LINK_HREF_ATTRIBUTE,
	type MermaidModuleLoader,
	neutralizeDiagramLinks,
} from "../components/markdown";
import {
	FALLBACK_MERMAID_TOKENS,
	MERMAID_FONT_FAMILY,
} from "../components/mermaid-diagram";

function createRenderer() {
	return {
		initialize: vi.fn(),
		render: vi.fn(async (id: string, source: string) => ({
			svg: `<svg data-id="${id}">${source}</svg>`,
		})),
	};
}

describe("DEFAULT_MERMAID_CONFIG", () => {
	test("is the light base theme with an Inter-first font, not `default`/monospace", () => {
		expect(DEFAULT_MERMAID_CONFIG).toMatchObject({
			fontFamily: MERMAID_FONT_FAMILY,
			securityLevel: "strict",
			startOnLoad: false,
			suppressErrorRendering: true,
			theme: "base",
		});
		expect(DEFAULT_MERMAID_CONFIG.fontFamily).not.toBe("monospace");
		expect(DEFAULT_MERMAID_CONFIG.themeVariables?.darkMode).toBe(false);
	});

	test("has a light/dark aware builder", () => {
		const dark = buildMermaidConfig(FALLBACK_MERMAID_TOKENS.dark, "dark");
		expect(dark.themeVariables?.darkMode).toBe(true);
		expect(dark.themeVariables?.background).toBe(
			FALLBACK_MERMAID_TOKENS.dark.background,
		);
	});
});

describe("createLazyMermaidPlugin", () => {
	test("keeps Mermaid opt-in while enabling the full interactive control set", () => {
		expect(agentMarkdownControls.mermaid).toBe(false);
		expect(agentMarkdownControlsWithMermaid.mermaid).toEqual({
			copy: true,
			download: true,
			fullscreen: true,
			panZoom: true,
		});
	});

	test("does not load Mermaid until the first diagram render", async () => {
		const renderer = createRenderer();
		const loader = vi.fn<MermaidModuleLoader>(async () => ({
			default: renderer,
		}));
		const plugin = createLazyMermaidPlugin(loader);

		expect(plugin).toMatchObject({
			language: "mermaid",
			name: "mermaid",
			type: "diagram",
		});
		expect(loader).not.toHaveBeenCalled();

		const instance = plugin.getMermaid();
		expect(loader).not.toHaveBeenCalled();
		await expect(
			instance.render("diagram-1", "flowchart LR\nA --> B"),
		).resolves.toEqual({
			svg: '<svg data-id="diagram-1">flowchart LR\nA --> B</svg>',
		});

		expect(loader).toHaveBeenCalledOnce();
		expect(renderer.initialize).toHaveBeenCalledOnce();
		expect(renderer.initialize).toHaveBeenCalledWith(
			expect.objectContaining({
				securityLevel: "strict",
				startOnLoad: false,
				suppressErrorRendering: true,
				theme: "base",
				themeVariables: expect.objectContaining({ darkMode: false }),
			}),
		);
		expect(renderer.render).toHaveBeenCalledWith(
			"diagram-1",
			"flowchart LR\nA --> B",
		);
	});

	test("initializes once until Streamdown supplies new diagram config", async () => {
		const renderer = createRenderer();
		const loader = vi.fn<MermaidModuleLoader>(async () => ({
			default: renderer,
		}));
		const plugin = createLazyMermaidPlugin(loader);
		const instance = plugin.getMermaid();

		await instance.render("one", "flowchart LR\nA --> B");
		await instance.render("two", "flowchart LR\nB --> C");
		expect(loader).toHaveBeenCalledTimes(1);
		expect(renderer.initialize).toHaveBeenCalledTimes(1);

		const reconfigured = plugin.getMermaid({
			securityLevel: "loose",
			theme: "dark",
		});
		await reconfigured.render("three", "flowchart LR\nC --> D");
		expect(renderer.initialize).toHaveBeenCalledTimes(2);
		expect(renderer.initialize).toHaveBeenLastCalledWith(
			expect.objectContaining({ securityLevel: "strict", theme: "dark" }),
		);
	});

	test("surfaces Mermaid render failures for Streamdown to handle safely", async () => {
		const error = new Error("invalid diagram");
		const renderer = {
			initialize: vi.fn(),
			render: vi.fn(async () => {
				throw error;
			}),
		};
		const plugin = createLazyMermaidPlugin(async () => ({ default: renderer }));

		await expect(
			plugin.getMermaid().render("invalid", "flowchart LR\nA -->"),
		).rejects.toBe(error);
		expect(renderer.initialize).toHaveBeenCalledWith(
			expect.objectContaining({ securityLevel: "strict" }),
		);
	});

	test("neutralizes diagram links in rendered output", async () => {
		const renderer = {
			initialize: vi.fn(),
			render: vi.fn(async () => ({
				svg: '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="https://evil.example.com/x">t</a></svg>',
			})),
		};
		const plugin = createLazyMermaidPlugin(async () => ({ default: renderer }));

		const { svg } = await plugin.getMermaid().render("linked", "flowchart LR");

		expect(svg).not.toContain("xlink:href");
		expect(svg).toContain(
			`${DIAGRAM_LINK_HREF_ATTRIBUTE}="https://evil.example.com/x"`,
		);
	});

	// This file runs under the package's default `node` environment, where
	// `DOMParser` is absent, so these exercise the pattern-based fallback.
	// `markdown-diagram-links.test.ts` covers the DOM parser path under jsdom.
	describe("neutralizeDiagramLinks (pattern fallback path)", () => {
		test("has no DOMParser available in this environment", () => {
			expect(typeof DOMParser).toBe("undefined");
		});

		test("strips a navigable href and preserves the destination", () => {
			const sanitized = neutralizeDiagramLinks(
				'<svg><a xlink:href="https://evil.example.com/harvest?t=1" data-look="classic"><text>Docs</text></a></svg>',
			);

			expect(sanitized).not.toContain("xlink:href");
			expect(sanitized).toContain(
				`${DIAGRAM_LINK_HREF_ATTRIBUTE}="https://evil.example.com/harvest?t=1"`,
			);
			expect(sanitized).toContain("<text>Docs</text>");
		});

		test("drops non-http(s) destinations without preserving them", () => {
			const sanitized = neutralizeDiagramLinks(
				`<svg><a href="javascript:alert(1)"><text>x</text></a></svg>`,
			);

			expect(sanitized.toLowerCase()).not.toContain("javascript:");
			expect(sanitized).not.toContain(DIAGRAM_LINK_HREF_ATTRIBUTE);
		});

		test("drops target alongside the href", () => {
			const sanitized = neutralizeDiagramLinks(
				'<svg><a target="_blank" href="https://example.com/"><text>x</text></a></svg>',
			);

			expect(sanitized).not.toContain("target=");
			expect(sanitized).toContain(
				`${DIAGRAM_LINK_HREF_ATTRIBUTE}="https://example.com/"`,
			);
		});

		test("passes through a diagram with no links untouched", () => {
			const plain = "<svg><text>No links</text></svg>";

			expect(neutralizeDiagramLinks(plain)).toBe(plain);
		});
	});

	test("retries the lazy import after a chunk load failure", async () => {
		const renderer = createRenderer();
		const error = new Error("chunk unavailable");
		const loader = vi
			.fn<MermaidModuleLoader>()
			.mockRejectedValueOnce(error)
			.mockResolvedValueOnce({ default: renderer });
		const instance = createLazyMermaidPlugin(loader).getMermaid();

		await expect(
			instance.render("first", "flowchart LR\nA --> B"),
		).rejects.toBe(error);
		await expect(
			instance.render("second", "flowchart LR\nA --> B"),
		).resolves.toEqual({
			svg: '<svg data-id="second">flowchart LR\nA --> B</svg>',
		});
		expect(loader).toHaveBeenCalledTimes(2);
	});
});
