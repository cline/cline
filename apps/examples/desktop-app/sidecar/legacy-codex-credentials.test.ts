import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearLegacyCodexCredentials } from "./legacy-codex-credentials";

describe("clearLegacyCodexCredentials", () => {
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

		expect(clearLegacyCodexCredentials(dataDir)).toBe(true);
		expect(JSON.parse(readFileSync(secretsPath, "utf8"))).toEqual({
			openRouterApiKey: "sk-or-keep",
		});
	});

	it("is a no-op when the file is missing or has no Codex credentials", () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "desktop-legacy-"));
		tempDirs.push(dataDir);
		expect(clearLegacyCodexCredentials(dataDir)).toBe(false);

		const secretsPath = path.join(dataDir, "secrets.json");
		writeFileSync(secretsPath, JSON.stringify({ apiKey: "keep" }));
		expect(clearLegacyCodexCredentials(dataDir)).toBe(false);
		expect(readFileSync(secretsPath, "utf8")).toBe(
			JSON.stringify({ apiKey: "keep" }),
		);

		writeFileSync(secretsPath, "{not json");
		expect(clearLegacyCodexCredentials(dataDir)).toBe(false);
	});
});
