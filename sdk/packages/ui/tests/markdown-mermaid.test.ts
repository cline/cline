import { beforeEach, describe, expect, test, vi } from "vitest";
import { createLazyMermaidPlugin } from "../components/markdown";

const mermaidMocks = vi.hoisted(() => ({
	initialize: vi.fn(),
	render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaidMocks }));

describe("createLazyMermaidPlugin", () => {
	beforeEach(() => {
		mermaidMocks.initialize.mockReset();
		mermaidMocks.render.mockReset();
		mermaidMocks.render.mockResolvedValue({ svg: "<svg>diagram</svg>" });
	});

	test("loads and initializes Mermaid only when a chart renders", async () => {
		const plugin = createLazyMermaidPlugin();
		const mermaid = plugin.getMermaid();

		expect(mermaidMocks.initialize).not.toHaveBeenCalled();
		expect(mermaidMocks.render).not.toHaveBeenCalled();

		await expect(mermaid.render("first", "graph TD; A-->B")).resolves.toEqual({
			svg: "<svg>diagram</svg>",
		});
		await mermaid.render("second", "graph TD; B-->C");

		expect(mermaidMocks.initialize).toHaveBeenCalledOnce();
		expect(mermaidMocks.initialize).toHaveBeenCalledWith(
			expect.objectContaining({
				securityLevel: "strict",
				startOnLoad: false,
				suppressErrorRendering: true,
			}),
		);
		expect(mermaidMocks.render).toHaveBeenCalledTimes(2);
	});

	test("pins strict security when callers provide Mermaid configuration", async () => {
		const plugin = createLazyMermaidPlugin();
		const mermaid = plugin.getMermaid({
			securityLevel: "loose",
			theme: "dark",
		});

		await mermaid.render("configured", "graph TD; A-->B");

		expect(mermaidMocks.initialize).toHaveBeenCalledWith(
			expect.objectContaining({
				securityLevel: "strict",
				theme: "dark",
			}),
		);
	});

	test("reinitializes exactly once after configuration changes", async () => {
		const plugin = createLazyMermaidPlugin();
		const mermaid = plugin.getMermaid();

		await mermaid.render("first", "graph TD; A-->B");
		plugin.getMermaid({ theme: "forest" });
		await mermaid.render("second", "graph TD; B-->C");
		await mermaid.render("third", "graph TD; C-->D");

		expect(mermaidMocks.initialize).toHaveBeenCalledTimes(2);
		expect(mermaidMocks.initialize).toHaveBeenLastCalledWith(
			expect.objectContaining({
				securityLevel: "strict",
				theme: "forest",
			}),
		);
	});
});
