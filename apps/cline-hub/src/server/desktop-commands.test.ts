import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDesktopCommand } from "./desktop-commands";
import { HubContext } from "./state";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("desktop marketplace commands", () => {
	it("returns the marketplace catalog through the desktop transport", async () => {
		const catalog = { version: 1, entries: [] };
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify(catalog), {
				headers: { "content-type": "application/json" },
			}),
		);

		await expect(
			handleDesktopCommand(new HubContext(), "get_marketplace_catalog"),
		).resolves.toEqual(catalog);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://cline.github.io/marketplace/catalog.json",
			{ headers: { Accept: "application/json" } },
		);
	});
});
