import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearLegacyProviderCredentials } from "./legacy-provider-credentials";

describe("clearLegacyProviderCredentials", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("removes only the Codex credentials from the legacy secrets file", () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "desktop-legacy-"));
		tempDirs.push(dataDir);
		const secretsPath = path.join(dataDir, "secrets.json");
		writeFileSync(
			secretsPath,
			JSON.stringify({
				"openai-codex-oauth-credentials": JSON.stringify({
					access_token: "a",
					refresh_token: "r",
				}),
				openRouterApiKey: "sk-or-keep",
			}),
		);

		expect(clearLegacyProviderCredentials("openai-codex", dataDir)).toBe(true);
		expect(JSON.parse(readFileSync(secretsPath, "utf8"))).toEqual({
			openRouterApiKey: "sk-or-keep",
		});
	});

	it("removes both Cline account secrets from the legacy secrets file", () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "desktop-legacy-"));
		tempDirs.push(dataDir);
		const secretsPath = path.join(dataDir, "secrets.json");
		writeFileSync(
			secretsPath,
			JSON.stringify({
				"cline:clineAccountId": JSON.stringify({ idToken: "t" }),
				clineApiKey: "cline-key",
				openRouterApiKey: "sk-or-keep",
			}),
		);

		expect(clearLegacyProviderCredentials("cline", dataDir)).toBe(true);
		expect(JSON.parse(readFileSync(secretsPath, "utf8"))).toEqual({
			openRouterApiKey: "sk-or-keep",
		});
	});

	it("is a no-op when the file is missing, has no matching credentials, or the provider is unknown", () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "desktop-legacy-"));
		tempDirs.push(dataDir);
		expect(clearLegacyProviderCredentials("openai-codex", dataDir)).toBe(false);

		const secretsPath = path.join(dataDir, "secrets.json");
		writeFileSync(secretsPath, JSON.stringify({ apiKey: "keep" }));
		expect(clearLegacyProviderCredentials("cline", dataDir)).toBe(false);
		expect(clearLegacyProviderCredentials("anthropic", dataDir)).toBe(false);
		expect(readFileSync(secretsPath, "utf8")).toBe(
			JSON.stringify({ apiKey: "keep" }),
		);

		writeFileSync(secretsPath, "{not json");
		expect(clearLegacyProviderCredentials("openai-codex", dataDir)).toBe(false);
	});
});
