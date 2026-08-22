import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GatewayGlobalSettingsStore } from "./global-settings";
import { tempDataRoot } from "./test-support";

describe("GatewayGlobalSettingsStore", () => {
	it("returns explicit defaults when no settings file exists", () => {
		const store = new GatewayGlobalSettingsStore({
			filePath: join(tempDataRoot("gateway-global-settings-"), "settings.json"),
		});
		expect(store.get()).toMatchObject({
			telemetryOptOut: false,
			autoUpdateEnabled: true,
		});
	});

	it("patches one setting while preserving unrelated fields", () => {
		const filePath = join(
			tempDataRoot("gateway-global-settings-"),
			"settings.json",
		);
		writeFileSync(
			filePath,
			JSON.stringify({
				telemetryOptOut: false,
				autoUpdateEnabled: true,
				theme: "dark",
				tools: { other_tool: { enabled: true } },
			}),
		);
		const store = new GatewayGlobalSettingsStore({ filePath });

		expect(store.patch({ webSearchEnabled: true })).toMatchObject({
			telemetryOptOut: false,
			autoUpdateEnabled: true,
			theme: "dark",
			tools: {
				other_tool: { enabled: true },
				web_search: { enabled: true },
			},
		});
		expect(store.patch({ telemetryOptOut: true })).toMatchObject({
			telemetryOptOut: true,
			autoUpdateEnabled: true,
			tools: { web_search: { enabled: true } },
		});
		expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({
			theme: "dark",
			tools: { other_tool: { enabled: true } },
		});
	});

	it("persists and clears the Gateway-owned voice selection", () => {
		const filePath = join(
			tempDataRoot("gateway-global-settings-"),
			"settings.json",
		);
		const store = new GatewayGlobalSettingsStore({ filePath });

		expect(
			store.setVoiceInput({
				providerId: "elevenlabs",
				modelId: "scribe_v2",
			}).voiceInput,
		).toEqual({ providerId: "elevenlabs", modelId: "scribe_v2" });
		expect(store.get().voiceInput).toEqual({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
		});

		expect(store.setVoiceInput(undefined).voiceInput).toBeUndefined();
		expect(JSON.parse(readFileSync(filePath, "utf8"))).not.toHaveProperty(
			"voiceInput",
		);
	});
});
