// Exercises the service module (lazy, serialized Mermaid rendering) of
// `components/diagrams/mermaid/` via the public façade.

import { describe, expect, test, vi } from "vitest";
import {
	createDefaultMermaidConfig,
	createMermaidService,
	type MermaidModuleLoader,
} from "../../../components/mermaid-diagram";

const FLOW = "flowchart LR\nA --> B";

describe("createMermaidService", () => {
	function renderer() {
		return {
			initialize: vi.fn(),
			render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"/>` })),
		};
	}

	test("does not import Mermaid until the first render", async () => {
		const mermaid = renderer();
		const loader = vi.fn<MermaidModuleLoader>(async () => ({
			default: mermaid,
		}));
		const service = createMermaidService(loader);
		expect(loader).not.toHaveBeenCalled();
		const config = createDefaultMermaidConfig();
		await service.render("a", FLOW, config);
		await service.render("b", FLOW, config);
		expect(loader).toHaveBeenCalledTimes(1);
		expect(mermaid.initialize).toHaveBeenCalledTimes(1);
		expect(mermaid.initialize).toHaveBeenCalledWith(config);
	});

	test("re-initializes only when the theme config changes", async () => {
		const mermaid = renderer();
		const service = createMermaidService(async () => ({ default: mermaid }));
		const light = createDefaultMermaidConfig("light");
		const dark = createDefaultMermaidConfig("dark");
		await service.render("a", FLOW, light);
		await service.render("b", FLOW, dark);
		await service.render("c", FLOW, dark);
		expect(mermaid.initialize).toHaveBeenCalledTimes(2);
		expect(mermaid.initialize).toHaveBeenLastCalledWith(dark);
	});

	test("retries the import after a chunk load failure", async () => {
		const mermaid = renderer();
		const error = new Error("chunk unavailable");
		const loader = vi
			.fn<MermaidModuleLoader>()
			.mockRejectedValueOnce(error)
			.mockResolvedValueOnce({ default: mermaid });
		const service = createMermaidService(loader);
		const config = createDefaultMermaidConfig();
		await expect(service.render("a", FLOW, config)).rejects.toBe(error);
		await expect(service.render("b", FLOW, config)).resolves.toEqual({
			svg: '<svg id="b"/>',
		});
		expect(loader).toHaveBeenCalledTimes(2);
	});

	// The owned block injects this SVG itself, bypassing the Streamdown diagram
	// plugin, so the service is the one place link neutralization can live.
	test("neutralizes diagram links in the rendered SVG", async () => {
		const mermaid = {
			initialize: vi.fn(),
			render: vi.fn(async () => ({
				svg: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://evil.example.com/" target="_blank"><text>Docs</text></a><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
			})),
		};
		const service = createMermaidService(async () => ({ default: mermaid }));
		const { svg } = await service.render(
			"a",
			FLOW,
			createDefaultMermaidConfig(),
		);
		expect(svg).not.toMatch(/\s(?:xlink:)?href\s*=/);
		expect(svg).not.toMatch(/\starget\s*=/);
		expect(svg).toContain(
			'data-cline-diagram-href="https://evil.example.com/"',
		);
		expect(svg).not.toContain("javascript:");
	});
});
