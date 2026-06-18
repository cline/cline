import { describe, expect, it } from "vitest";
import { isWebviewRoute, normalizeWebviewIndexHtml } from "./http";

describe("isWebviewRoute", () => {
	it.each([
		"/",
		"/chat",
		"/sessions",
		"/models",
		"/customizations",
		"/rules",
		"/hooks",
		"/mcp",
		"/plugins",
		"/skills",
		"/agents",
		"/tools",
		"/marketplace",
		"/marketplace/mcp",
		"/marketplace/skills",
		"/marketplace/plugins",
		"/channels",
		"/schedules",
		"/settings",
		"/settings/providers",
	])("matches dashboard SPA route %s", (pathname) => {
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

	it("injects the persisted theme bootstrap once", () => {
		const normalized = normalizeWebviewIndexHtml(
			"<html><head></head><body></body></html>",
		);

		expect(normalized).toContain('id="cline-hub-theme-bootstrap"');
		expect(normalizeWebviewIndexHtml(normalized)).toBe(normalized);
	});
});
