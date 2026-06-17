import { describe, expect, it } from "vitest";
import { isWebviewRoute } from "./http";

describe("isWebviewRoute", () => {
	it.each([
		"/marketplace",
		"/marketplace/mcp",
		"/marketplace/skills",
		"/marketplace/plugins",
	])("matches marketplace SPA route %s", (pathname) => {
		expect(isWebviewRoute(pathname)).toBe(true);
	});
});
