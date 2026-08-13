import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClientSettingsManager } from "./client-settings-manager";

describe("ClientSettingsManager", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function createManagers() {
		const root = mkdtempSync(join(tmpdir(), "cline-client-settings-"));
		tempDirs.push(root);
		const filePath = join(root, "settings.json");
		return {
			filePath,
			first: new ClientSettingsManager({ filePath }),
			second: new ClientSettingsManager({ filePath }),
		};
	}

	it("persists mode settings independently across manager instances", () => {
		const { filePath, first, second } = createManagers();
		first.setModeSettings("voiceInput", {
			providerId: "openai",
			modelId: "whisper-1",
		});
		second.setModeSettings("realtimeVoice", {
			providerId: "google",
			modelId: "gemini-live",
			voice: "Kore",
		});

		expect(first.read().modes).toEqual({
			voiceInput: { providerId: "openai", modelId: "whisper-1" },
			realtimeVoice: {
				providerId: "google",
				modelId: "gemini-live",
				voice: "Kore",
			},
		});
		expect(existsSync(`${filePath}.lock`)).toBe(false);
	});

	it("seeds legacy modes only when the client file is missing", () => {
		const { first } = createManagers();
		first.initializeModesIfMissing({
			voiceInput: { providerId: "openai", modelId: "whisper-1" },
		});
		first.setModeSettings("voiceInput", undefined);
		first.initializeModesIfMissing({
			voiceInput: { providerId: "google", modelId: "gemini-audio" },
		});

		expect(first.read().modes).toEqual({});
	});
});
