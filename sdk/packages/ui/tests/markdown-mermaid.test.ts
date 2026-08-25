import { describe, expect, test, vi } from "vitest";
import {
	agentMarkdownControls,
	agentMarkdownControlsWithMermaid,
	createLazyMermaidPlugin,
	type MermaidModuleLoader,
} from "../components/markdown";

function createRenderer() {
	return {
		initialize: vi.fn(),
		render: vi.fn(async (id: string, source: string) => ({
			svg: `<svg data-id="${id}">${source}</svg>`,
		})),
	};
}

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
});
