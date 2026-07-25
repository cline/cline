import { describe, expect, it } from "vitest";
import { locationPath, pathWithLocationHash } from "./navigation-url";

const inviteHash =
	"#bridgeUrl=ws%3A%2F%2F127.0.0.1%3A8787&roomSecret=dashboard-secret";

describe("dashboard navigation URLs", () => {
	it("includes the invite fragment in the current location", () => {
		expect(
			locationPath({
				pathname: "/sessions",
				search: "?filter=active",
				hash: inviteHash,
			}),
		).toBe(`/sessions?filter=active${inviteHash}`);
	});

	it.each([
		"/",
		"/settings",
		"/chat?sessionId=session-1",
	])("preserves bridge credentials while navigating to %s", (path) => {
		expect(pathWithLocationHash(path, { hash: inviteHash })).toBe(
			`${path}${inviteHash}`,
		);
	});
});
