import { describe, expect, it } from "vitest";
import { getClineDashboardUrl } from "./cline-dashboard-url";

const APP = "https://app.cline.bot";

describe("getClineDashboardUrl", () => {
	it("returns undefined without a path or app base URL", () => {
		expect(getClineDashboardUrl(undefined, APP, "cline-cli")).toBeUndefined();
		expect(getClineDashboardUrl("", APP, "cline-cli")).toBeUndefined();
		expect(
			getClineDashboardUrl("/dashboard/account", undefined, "cline-cli"),
		).toBeUndefined();
	});

	it("opens the path on the app, keeping its query string and tagging the client", () => {
		expect(
			getClineDashboardUrl(
				"/dashboard/account?tab=privacy",
				"https://staging-app.cline.bot/",
				"cline-jetbrains",
			),
		).toBe(
			"https://staging-app.cline.bot/dashboard/account?tab=privacy&client=cline-jetbrains",
		);
	});

	it("drops the app base URL's own query string and still appends the client", () => {
		expect(
			getClineDashboardUrl(
				"dashboard",
				"https://app.cline.bot?ref=docs",
				"cline-cli",
			),
		).toBe("https://app.cline.bot/dashboard?client=cline-cli");
	});

	it.each([
		["an absolute URL on another host", "https://evil.example/dashboard"],
		["a protocol-relative URL", "//evil.example/dashboard"],
		["a javascript: URL", "javascript:alert(1)"],
		["an editor deep link", "vscode://saoudrizwan.claude-dev/open"],
		["a file URL", "file:///etc/passwd"],
		["the app host over plain http", "http://app.cline.bot/dashboard"],
	])("rejects %s", (_name, path) => {
		expect(getClineDashboardUrl(path, APP, "cline-cli")).toBeUndefined();
	});

	it("returns undefined for an unusable app base URL", () => {
		expect(
			getClineDashboardUrl("/dashboard", "not a url", "cline-cli"),
		).toBeUndefined();
	});
});
