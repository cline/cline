import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	resolveAgentTeamsEnabled,
	resolveSpawnAgentEnabled,
} from "./session-capabilities";

describe("session capability resolution", () => {
	const previousGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;
	const tempDirs: string[] = [];

	afterEach(() => {
		process.env.CLINE_GLOBAL_SETTINGS_PATH = previousGlobalSettingsPath;
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function useTempGlobalSettings(settings: Record<string, unknown>): void {
		const dir = mkdtempSync(join(tmpdir(), "cline-capabilities-settings-"));
		tempDirs.push(dir);
		const settingsPath = join(dir, "global-settings.json");
		writeFileSync(settingsPath, JSON.stringify(settings));
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
	}

	it("defaults spawn_agent and teams off without an opt-in", () => {
		useTempGlobalSettings({});
		expect(resolveSpawnAgentEnabled({ mode: "act" })).toBe(false);
		expect(resolveAgentTeamsEnabled({ mode: "act" })).toBe(false);
	});

	it("enables spawn_agent and teams via the enabledTools opt-in", () => {
		useTempGlobalSettings({ enabledTools: ["spawn_agent", "teams"] });
		expect(resolveSpawnAgentEnabled({ mode: "act" })).toBe(true);
		expect(resolveAgentTeamsEnabled({ mode: "act" })).toBe(true);
	});

	it("keeps the opt-in gated by the mode preset", () => {
		useTempGlobalSettings({ enabledTools: ["spawn_agent", "teams"] });
		expect(resolveSpawnAgentEnabled({ mode: "yolo" })).toBe(false);
		expect(resolveAgentTeamsEnabled({ mode: "yolo" })).toBe(false);
	});

	it("lets explicit session values win over the opt-in state", () => {
		useTempGlobalSettings({});
		expect(
			resolveSpawnAgentEnabled({ mode: "act", enableSpawnAgent: true }),
		).toBe(true);
		expect(
			resolveAgentTeamsEnabled({ mode: "act", enableAgentTeams: true }),
		).toBe(true);

		useTempGlobalSettings({ enabledTools: ["spawn_agent", "teams"] });
		expect(
			resolveSpawnAgentEnabled({ mode: "act", enableSpawnAgent: false }),
		).toBe(false);
		expect(
			resolveAgentTeamsEnabled({ mode: "act", enableAgentTeams: false }),
		).toBe(false);
	});
});
