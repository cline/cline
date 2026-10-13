import { describe, expect, it } from "vitest";
import { resolveClineAppUrl } from "./cline-app-url";

const APP = "https://app.cline.bot";

describe("resolveClineAppUrl", () => {
	it("returns undefined when there is no path", () => {
		expect(resolveClineAppUrl(undefined, APP)).toBeUndefined();
		expect(resolveClineAppUrl("", APP)).toBeUndefined();
	});

	it("resolves a path on the app origin and keeps its query string", () => {
		const url = resolveClineAppUrl(
			"/dashboard/account?tab=privacy",
			"https://staging-app.cline.bot/",
		);
		expect(url?.href).toBe(
			"https://staging-app.cline.bot/dashboard/account?tab=privacy",
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
		expect(resolveClineAppUrl(path, APP)).toBeUndefined();
	});

	it("returns undefined for an unusable app base URL", () => {
		expect(resolveClineAppUrl("/dashboard", "not a url")).toBeUndefined();
	});
});
