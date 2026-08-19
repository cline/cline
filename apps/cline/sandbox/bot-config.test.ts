import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBotProviderSettingsPath, type BotHome } from "./bot-config";

const createdPaths: string[] = [];

afterEach(() => {
	for (const path of createdPaths.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("resolveBotProviderSettingsPath", () => {
	it("falls back to the shared provider settings when the bot has no override", () => {
		const homeDir = join(
			tmpdir(),
			`cline-bot-provider-fallback-${crypto.randomUUID()}`,
		);
		createdPaths.push(homeDir);
		const bot: BotHome = { id: "test", homeDir };

		expect(resolveBotProviderSettingsPath(bot)).toBe(
			join(homedir(), ".cline", "data", "settings", "providers.json"),
		);
	});

	it("prefers the bot-specific provider settings when they exist", () => {
		const homeDir = join(
			tmpdir(),
			`cline-bot-provider-override-${crypto.randomUUID()}`,
		);
		createdPaths.push(homeDir);
		const botPath = join(homeDir, "data", "settings", "providers.json");
		mkdirSync(join(homeDir, "data", "settings"), { recursive: true });
		writeFileSync(botPath, "{}\n");

		expect(resolveBotProviderSettingsPath({ id: "test", homeDir })).toBe(
			botPath,
		);
	});
});
