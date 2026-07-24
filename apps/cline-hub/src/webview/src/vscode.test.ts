import { afterEach, describe, expect, it, vi } from "vitest";

const browserConnectionKey = "cline-hub-browser-connection";

function stubBrowserWindow(
	url: string,
	persistedConnection?: Record<string, unknown>,
): Map<string, string> {
	const storage = new Map<string, string>();
	if (persistedConnection) {
		storage.set(browserConnectionKey, JSON.stringify(persistedConnection));
	}
	vi.stubGlobal("window", {
		location: new URL(url),
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
		},
	});
	return storage;
}

describe("browser dashboard connection target", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses the current invite secret without persisting rotating credentials", async () => {
		const storage = stubBrowserWindow(
			"https://cline.bot/dashboard#bridgeUrl=http%3A%2F%2F127.0.0.1%3A8787&roomSecret=fresh-secret",
			{
				bridgeUrl: "http://127.0.0.1:9999",
				roomSecret: "stale-secret",
			},
		);
		const { readBrowserConnectionTarget, writeBrowserConnectionTarget } =
			await import("./vscode");

		expect(readBrowserConnectionTarget()).toEqual({
			bridgeUrl: "http://127.0.0.1:8787",
			roomSecret: "fresh-secret",
		});

		writeBrowserConnectionTarget({ bridgeUrl: "http://127.0.0.1:8787" });
		expect(JSON.parse(storage.get(browserConnectionKey) ?? "{}")).toEqual({
			bridgeUrl: "http://127.0.0.1:8787",
		});
	});

	it("ignores a room secret left by an older dashboard process", async () => {
		stubBrowserWindow("https://cline.bot/dashboard", {
			bridgeUrl: "http://127.0.0.1:8787",
			roomSecret: "stale-secret",
		});
		const { readBrowserConnectionTarget } = await import("./vscode");

		expect(readBrowserConnectionTarget()).toEqual({
			bridgeUrl: "http://127.0.0.1:8787",
			roomSecret: undefined,
		});
	});
});
