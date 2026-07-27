import { describe, expect, it } from "vitest";
import { sameHubUrl } from "./hub-url";

describe("sameHubUrl", () => {
	it("ignores fragments that are not sent to the hub", () => {
		expect(
			sameHubUrl(
				"ws://127.0.0.1:25463/hub#dashboard",
				"ws://127.0.0.1:25463/hub",
			),
		).toBe(true);
	});

	it("treats an auth token change as a new connection target", () => {
		expect(
			sameHubUrl(
				"ws://127.0.0.1:25463/hub?authToken=new-token",
				"ws://127.0.0.1:25463/hub",
			),
		).toBe(false);
		expect(
			sameHubUrl(
				"ws://127.0.0.1:25463/hub?authToken=new-token",
				"ws://127.0.0.1:25463/hub?authToken=old-token",
			),
		).toBe(false);
	});
});
