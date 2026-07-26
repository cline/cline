import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BedrockSettingsStore } from "./bedrock-settings-store";

describe("BedrockSettingsStore", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function createManager() {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-bedrock-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		return {
			tempDir,
			filePath,
			store: new BedrockSettingsStore({ filePath }),
		};
	}

	const settings = {
		provider: "bedrock" as const,
		model: "anthropic.claude-sonnet-4-20250514-v1:0",
		connection: {
			region: "ca-central-1",
			profile: "engineering-sso",
		},
	};

	it("persists and restores Bedrock settings", () => {
		const { filePath, store } = createManager();
		store.save(settings);

		const reloaded = new BedrockSettingsStore({ filePath });
		expect(reloaded.getSettings()).toEqual(settings);
		expect(reloaded.getConfig()).toMatchObject({
			providerId: "bedrock",
			modelId: settings.model,
			connection: settings.connection,
		});
	});

	it("writes atomically without leaving a temporary file", () => {
		const { tempDir, store } = createManager();
		store.save(settings);
		expect(readdirSync(tempDir)).toEqual(["provider-settings.json"]);
	});

	it("preserves the previous file when a staged write fails", () => {
		const { filePath, store } = createManager();
		store.save(settings);
		const before = readFileSync(filePath, "utf8");

		mkdirSync(`${filePath}.${process.pid}.tmp`);
		expect(() =>
			store.save({
				...settings,
				connection: { region: "us-west-2" },
			}),
		).toThrow();
		rmSync(`${filePath}.${process.pid}.tmp`, {
			recursive: true,
			force: true,
		});

		expect(readFileSync(filePath, "utf8")).toBe(before);
	});

	it("migrates the retained Bedrock fields from legacy state", () => {
		const { filePath } = createManager();
		writeFileSync(
			filePath,
			JSON.stringify({
				providers: {
					bedrock: {
						settings: {
							modelId: settings.model,
							aws: {
								region: "ca-central-1",
								profile: "engineering-sso",
							},
						},
					},
				},
			}),
		);

		const store = new BedrockSettingsStore({ filePath });
		expect(store.getSettings()).toEqual(settings);
		expect(store.read().providers.bedrock?.tokenSource).toBe("migration");
	});

	it("ignores invalid persisted JSON", () => {
		const { filePath } = createManager();
		writeFileSync(filePath, "{ not-json", "utf8");
		const store = new BedrockSettingsStore({ filePath });
		expect(store.read()).toEqual({
			version: 2,
			lastUsedProvider: "bedrock",
			providers: {},
		});
	});
});
