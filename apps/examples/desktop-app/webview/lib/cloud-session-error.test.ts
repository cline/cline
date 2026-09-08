import { describe, expect, it } from "vitest";
import { parseCloudSessionError } from "./cloud-session-error";

describe("parseCloudSessionError", () => {
	it("parses environment-aware GitHub connection guidance", () => {
		expect(
			parseCloudSessionError(
				'CLOUD_SESSION_ERROR:{"code":"github_not_connected","message":"Connect GitHub","connectUrl":"https://app.cline.bot/dashboard/integrations"}',
			),
		).toEqual({
			code: "github_not_connected",
			message: "Connect GitHub",
			connectUrl: "https://app.cline.bot/dashboard/integrations",
		});
	});

	it("accepts connect URLs from every known Cline app environment", () => {
		expect(
			parseCloudSessionError(
				'CLOUD_SESSION_ERROR:{"code":"github_not_connected","message":"Connect GitHub","connectUrl":"https://staging-app.cline.bot/dashboard/organization/integrations"}',
			)?.connectUrl,
		).toBe("https://staging-app.cline.bot/dashboard/organization/integrations");
	});

	it("drops connect URLs outside the Cline app origins", () => {
		// The envelope is authenticated by string prefix only, so a pod-
		// controlled error string can spoof it; an attacker-chosen URL must
		// never become a trusted-looking Connect GitHub button.
		for (const hostile of [
			"https://attacker.example/github-oauth",
			"https://app.cline.bot.evil.example/dashboard",
			"javascript:alert(1)",
			"not a url",
		]) {
			const parsed = parseCloudSessionError(
				`CLOUD_SESSION_ERROR:${JSON.stringify({
					code: "github_not_connected",
					message: "Reconnect GitHub to continue",
					connectUrl: hostile,
				})}`,
			);
			expect(parsed?.code).toBe("github_not_connected");
			expect(parsed?.connectUrl).toBeUndefined();
		}
	});

	it("ignores ordinary and malformed errors", () => {
		expect(parseCloudSessionError("fetch failed")).toBeNull();
		expect(parseCloudSessionError("CLOUD_SESSION_ERROR:not-json")).toBeNull();
	});
});
