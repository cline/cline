import { describe, expect, it } from "vitest";
import { preserveHubUrlAuthToken, sameHubUrl } from "./hub-url";

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

describe("preserveHubUrlAuthToken", () => {
	it("keeps a custom auth token when hub state strips it", () => {
		expect(
			preserveHubUrlAuthToken(
				"ws://custom.example.test/hub?authToken=custom-token",
				"ws://custom.example.test/hub",
			),
		).toBe("ws://custom.example.test/hub?authToken=custom-token");
	});

	it("replaces the input when the hub endpoint changes", () => {
		expect(
			preserveHubUrlAuthToken(
				"ws://custom.example.test/hub?authToken=custom-token",
				"ws://127.0.0.1:25463/hub",
			),
		).toBe("ws://127.0.0.1:25463/hub");
	});
});
