import { describe, expect, it } from "vitest";
import { parseDesktopDeepLink } from "./desktop-deep-links";

describe("parseDesktopDeepLink", () => {
	it("accepts host-style and path-style routes", () => {
		expect(
			parseDesktopDeepLink("cline://open-project?path=%2Ftmp%2Frepo"),
		).toEqual({
			type: "open-project",
			path: "/tmp/repo",
			prompt: undefined,
		});
		expect(
			parseDesktopDeepLink("cline:///new-session?prompt=fix%20it"),
		).toEqual({
			type: "new-session",
			path: undefined,
			prompt: "fix it",
		});
	});

	it("parses sessions and auth without exposing tokens as fields", () => {
		expect(
			parseDesktopDeepLink("cline://session?id=abc&prompt=continue"),
		).toEqual({
			type: "open-session",
			sessionId: "abc",
			prompt: "continue",
		});
		expect(
			parseDesktopDeepLink("cline://auth?code=secret&provider=cline"),
		).toEqual({
			type: "auth",
			url: "cline://auth?code=secret&provider=cline",
			provider: "cline",
		});
	});

	it("rejects unknown, malformed, and incomplete links", () => {
		expect(parseDesktopDeepLink("https://example.com/new-session")).toBeNull();
		expect(parseDesktopDeepLink("cline://open-project")).toBeNull();
		expect(parseDesktopDeepLink("cline://session")).toBeNull();
	});
});
