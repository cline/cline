import { describe, expect, it } from "vitest";
import { isWebviewRoute, normalizeWebviewIndexHtml } from "./http";

describe("isWebviewRoute", () => {
	it.each([
		"/marketplace",
		"/marketplace/mcp",
		"/marketplace/skills",
		"/marketplace/plugins",
	])("matches marketplace SPA route %s", (pathname) => {
		expect(isWebviewRoute(pathname)).toBe(true);
	});

	it("does not treat nested marketplace asset requests as SPA routes", () => {
		expect(isWebviewRoute("/marketplace/assets/index.js")).toBe(false);
	});
});

describe("normalizeWebviewIndexHtml", () => {
	it("rewrites relative built asset URLs so deep links can refresh", () => {
		expect(
			normalizeWebviewIndexHtml(
				'<script type="module" src="./assets/index.js"></script><link href="./assets/index.css">',
			),
		).toBe(
			'<script type="module" src="/assets/index.js"></script><link href="/assets/index.css">',
		);
	});
});
