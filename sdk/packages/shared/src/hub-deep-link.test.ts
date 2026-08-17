import { describe, expect, it } from "vitest";
import { parseClineDeepLink } from "./hub";

describe("parseClineDeepLink", () => {
	it("parses project, new-session, and existing-session actions", () => {
		expect(
			parseClineDeepLink("cline://open-project?path=%2Ftmp%2Frepo"),
		).toEqual({
			type: "open_project",
			path: "/tmp/repo",
			prompt: undefined,
		});
		expect(parseClineDeepLink("cline:///new-session?prompt=fix%20it")).toEqual({
			type: "new_session",
			path: undefined,
			prompt: "fix it",
		});
		expect(parseClineDeepLink("cline://session?id=s_1")).toEqual({
			type: "open_session",
			sessionId: "s_1",
			prompt: undefined,
		});
	});

	it("returns a sanitized auth action", () => {
		expect(
			parseClineDeepLink("cline://auth?code=secret&provider=cline"),
		).toEqual({
			type: "auth",
			provider: "cline",
		});
	});

	it("rejects untrusted, unsupported, and incomplete URLs", () => {
		expect(parseClineDeepLink("https://example.com/new-session")).toBeNull();
		expect(parseClineDeepLink("cline://unknown")).toBeNull();
		expect(parseClineDeepLink("cline://open-project")).toBeNull();
	});
});
