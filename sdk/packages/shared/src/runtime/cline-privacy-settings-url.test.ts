import { describe, expect, it } from "vitest";
import { getClinePrivacySettingsUrl } from "./cline-privacy-settings-url";

const APP = "https://app.cline.bot";

describe("getClinePrivacySettingsUrl", () => {
	it("returns undefined when the API sent no path", () => {
		expect(getClinePrivacySettingsUrl(undefined, APP, "cli")).toBeUndefined();
		expect(getClinePrivacySettingsUrl("", APP, "cli")).toBeUndefined();
	});

	it("returns undefined when the app base URL is unknown", () => {
		expect(
			getClinePrivacySettingsUrl("/dashboard/account", undefined, "cli"),
		).toBeUndefined();
	});

	it("opens the path on the app, keeping its query string and tagging the client", () => {
		expect(
			getClinePrivacySettingsUrl(
				"/dashboard/account?tab=privacy",
				"https://staging-app.cline.bot/",
				"jetbrains",
			),
		).toBe(
			"https://staging-app.cline.bot/dashboard/account?tab=privacy&client=jetbrains",
		);
	});

	it.each([
		["an absolute URL on another host", "https://evil.example/dashboard"],
		["a protocol-relative URL", "//evil.example/dashboard"],
		["a javascript: URL", "javascript:alert(1)"],
		["an editor deep link", "vscode://saoudrizwan.claude-dev/open"],
		["a file URL", "file:///etc/passwd"],
		["the app host over plain http", "http://app.cline.bot/dashboard"],
	])("rejects %s", (_name, path) => {
		expect(getClinePrivacySettingsUrl(path, APP, "cli")).toBeUndefined();
	});

	it("returns undefined for an unusable app base URL", () => {
		expect(
			getClinePrivacySettingsUrl("/dashboard", "not a url", "cli"),
		).toBeUndefined();
	});
});
