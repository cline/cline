import { describe, expect, it } from "vitest";
import { parseCloudSessionError } from "./cloud-session-error";

describe("parseCloudSessionError", () => {
	it("parses environment-aware GitHub connection guidance", () => {
		expect(
			parseCloudSessionError(
				'CLOUD_SESSION_ERROR:{"code":"github_not_connected","message":"Connect GitHub","connectUrl":"https://app.example.test/dashboard/integrations"}',
			),
		).toEqual({
			code: "github_not_connected",
			message: "Connect GitHub",
			connectUrl: "https://app.example.test/dashboard/integrations",
		});
	});

	it("ignores ordinary and malformed errors", () => {
		expect(parseCloudSessionError("fetch failed")).toBeNull();
		expect(parseCloudSessionError("CLOUD_SESSION_ERROR:not-json")).toBeNull();
	});
});
