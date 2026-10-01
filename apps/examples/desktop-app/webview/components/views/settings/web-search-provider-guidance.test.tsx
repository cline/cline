// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WebSearchProviderGuidance } from "./web-search-provider-guidance";

const catalog = vi.hoisted(() => ({
	fetch: vi.fn(),
	invalidate: () => {},
	unsubscribe: vi.fn(),
}));
vi.mock("@/lib/provider-model-catalog", () => ({
	fetchProviderCatalog: catalog.fetch,
	subscribeToProviderCatalogInvalidation: (callback: () => void) => {
		catalog.invalidate = callback;
		return catalog.unsubscribe;
	},
}));

it("offers provider setup and refreshes readiness when provider settings change", async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	catalog.fetch.mockResolvedValue({ providers: [] });
	const navigate = vi.fn();
	const container = document.createElement("div");
	const root = createRoot(container);
	try {
		await act(async () =>
			root.render(
				<WebSearchProviderGuidance onOpenModelProviders={navigate} />,
			),
		);
		expect(container.textContent).toContain("this setting has no effect yet");
		catalog.fetch.mockRejectedValueOnce(new Error("Temporary catalog failure"));
		await act(async () => catalog.invalidate());
		expect(container.textContent).toContain("this setting has no effect yet");
		expect(container.querySelector("button")?.textContent).toContain(
			"Connect a provider",
		);
		await act(async () => container.querySelector("button")?.click());
		expect(navigate).toHaveBeenCalledOnce();
		catalog.fetch.mockResolvedValue({
			providers: [
				{
					id: "anthropic",
					name: "Anthropic",
					enabled: true,
					modelTools: ["web_search"],
				},
				{
					id: "openai",
					name: "OpenAI",
					enabled: false,
					modelTools: ["web_search"],
				},
			],
		});
		await act(async () => catalog.invalidate());
		expect(container.textContent).toContain("Ready to use with Anthropic");
		expect(container.textContent).not.toContain("OpenAI");
		expect(container.querySelector("button")).toBeNull();
		catalog.fetch.mockRejectedValueOnce(new Error("Temporary catalog failure"));
		await act(async () => catalog.invalidate());
		expect(container.textContent).toContain("Ready to use with Anthropic");
		expect(container.querySelector("button")).toBeNull();
	} finally {
		await act(async () => root.unmount());
	}
	expect(catalog.unsubscribe).toHaveBeenCalledOnce();
});
