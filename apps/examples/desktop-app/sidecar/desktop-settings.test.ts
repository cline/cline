import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { factoryPresetSchema } from "../webview/lib/factory-presets";
import {
	readDesktopSettings,
	resolveDesktopSettingsPath,
	setCloudSessionsEnabled,
	writeDesktopSettings,
} from "./desktop-settings";
import { handleFactoryCommand } from "./factory-commands";

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-desktop-settings-"));
	process.env.CLINE_DATA_DIR = dataDir;
});

afterEach(() => {
	delete process.env.CLINE_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
});

describe("desktop settings", () => {
	it("excludes feature-specific configuration from saved presets", () => {
		const preset = factoryPresetSchema.parse({
			name: "Clean",
			config: {
				checks: [{ name: "Check", command: "verify", kind: "test" }],
				execution: "cloud",
				publishPullRequest: true,
				watchPullRequest: true,
				implementationUnits: [
					{ id: "unit", instructions: "Feature work", dependsOn: [] },
				],
				documents: [{ name: "private.md", content: "Feature details" }],
				sourceIssue: {
					provider: "github",
					id: "owner/repo#1",
					url: "https://github.com/owner/repo/issues/1",
				},
			},
		});
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryPresets: [preset],
		});
		const persisted = readFileSync(resolveDesktopSettingsPath(), "utf8");
		expect(persisted).not.toContain("private.md");
		expect(persisted).not.toContain("owner/repo");
		expect(readDesktopSettings().factoryPresets?.[0]?.config).toEqual({
			approval: "required",
			maxRepairRounds: 2,
		});
	});

	it("round trips local presets and preserves the default on unrelated preset and cloud changes", async () => {
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryDefaultPreset: "Focused",
			factoryPresets: [
				{
					name: "Focused",
					config: {
						approval: "required",
						maxRepairRounds: 1,
						agents: {
							designer: {},
							planReviewers: [{}],
							implementers: [
								{ instructions: "Small changes" },
								{ modelSelection: { providerId: "example", modelId: "second" } },
							],
							reviewers: [{}],
						},
					},
				},
			],
		});
		const settings = readDesktopSettings();
		expect(settings.factoryPresets?.[0]?.config.agents?.implementers).toEqual([
			{ instructions: "Small changes" },
			{ modelSelection: { providerId: "example", modelId: "second" } },
		]);
		expect(setCloudSessionsEnabled(true)).toEqual({
			...settings,
			cloudSessionsEnabled: true,
		});
		await handleFactoryCommand(
			{ pendingQuestions: new Map() },
			"factory_save_preset",
			{ name: "Second", config: {}, useByDefault: false },
			async () => {
				throw new Error("Preset save must not access tasks");
			},
		);
		expect(readDesktopSettings().cloudSessionsEnabled).toBe(true);
		expect(readDesktopSettings().factoryDefaultPreset).toBe("Focused");
		expect(
			readDesktopSettings().factoryPresets?.map((preset) => preset.name),
		).toEqual(["Focused", "Second"]);
	});

	it("selects, changes, and explicitly clears the default through preset saves", async () => {
		const readTask = async () => {
			throw new Error("Preset save must not access tasks");
		};
		const ctx = { pendingQuestions: new Map() };
		await handleFactoryCommand(
			ctx,
			"factory_save_preset",
			{ name: " First ", config: {}, useByDefault: true },
			readTask,
		);
		expect(readDesktopSettings().factoryDefaultPreset).toBe("First");
		await handleFactoryCommand(
			ctx,
			"factory_save_preset",
			{ name: "Second", config: {}, useByDefault: true },
			readTask,
		);
		expect(readDesktopSettings().factoryDefaultPreset).toBe("Second");
		const saved = await handleFactoryCommand(
			ctx,
			"factory_save_preset",
			{ name: "Second", config: { maxRepairRounds: 1 } },
			readTask,
		);
		expect(readDesktopSettings().factoryDefaultPreset).toBe("Second");
		expect(saved).toEqual(readDesktopSettings().factoryPresets);
		await handleFactoryCommand(
			ctx,
			"factory_save_preset",
			{ name: "Second", config: {}, useByDefault: false },
			readTask,
		);
		expect(readDesktopSettings().factoryDefaultPreset).toBeUndefined();
		expect(readDesktopSettings().factoryPresets?.map(({ name }) => name)).toEqual([
			"First",
			"Second",
		]);
		expect(readFileSync(resolveDesktopSettingsPath(), "utf8")).not.toContain(
			"useByDefault",
		);
	});

	it("normalizes a legacy saved implementer without losing its configuration or default on save and reopen", async () => {
		const implementer = {
			profile: "builder",
			modelSelection: { providerId: "example", modelId: "example-model" },
			instructions: "Keep changes focused",
			skills: ["verification"],
			tools: ["read_file"],
			timeoutSeconds: 600,
			maxIterations: 50,
		};
		mkdirSync(dirname(resolveDesktopSettingsPath()), { recursive: true });
		writeFileSync(
			resolveDesktopSettingsPath(),
			JSON.stringify({
				cloudSessionsEnabled: true,
				factoryDefaultPreset: "Legacy",
				factoryPresets: [
					{ name: "Legacy", config: { agents: { implementer } } },
				],
			}),
		);
		const preset = readDesktopSettings().factoryPresets?.[0];
		expect(preset?.config.agents?.implementers).toEqual([implementer]);
		expect(preset?.config.agents).not.toHaveProperty("implementer");
		await handleFactoryCommand(
			{ pendingQuestions: new Map() },
			"factory_save_preset",
			{ ...preset },
			async () => {
				throw new Error("Preset save must not access tasks");
			},
		);
		expect(readDesktopSettings()).toEqual({
			cloudSessionsEnabled: true,
			factoryDefaultPreset: "Legacy",
			factoryPresets: [preset],
		});
	});

	it("keeps valid presets and missing default metadata when another saved preset is invalid", async () => {
		mkdirSync(dirname(resolveDesktopSettingsPath()), { recursive: true });
		writeFileSync(
			resolveDesktopSettingsPath(),
			JSON.stringify({
				cloudSessionsEnabled: true,
				factoryDefaultPreset: "Broken",
				factoryPresets: [
					{ name: "Valid", config: { maxRepairRounds: 1 } },
					{ name: "Broken", config: { maxRepairRounds: -1 } },
				],
			}),
		);
		expect(
			readDesktopSettings().factoryPresets?.map((preset) => preset.name),
		).toEqual(["Valid"]);
		await handleFactoryCommand(
			{ pendingQuestions: new Map() },
			"factory_save_preset",
			{ name: "New", config: {} },
			async () => {
				throw new Error("Unexpected task access");
			},
		);
		const saved = readDesktopSettings();
		expect(saved.cloudSessionsEnabled).toBe(true);
		expect(saved.factoryDefaultPreset).toBe("Broken");
		expect(saved.factoryPresets?.map((preset) => preset.name)).toEqual([
			"Valid",
			"New",
		]);
	});
	it("defaults cloud sessions to off when no settings file exists", () => {
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: false });
	});

	it("persists the cloud sessions opt-in and reads it back", () => {
		expect(setCloudSessionsEnabled(true)).toEqual({
			cloudSessionsEnabled: true,
		});
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: true });
		expect(resolveDesktopSettingsPath().endsWith("code-settings.json")).toBe(
			true,
		);
		expect(
			JSON.parse(readFileSync(resolveDesktopSettingsPath(), "utf8")),
		).toMatchObject({ cloudSessionsEnabled: true });
		expect(setCloudSessionsEnabled(false)).toEqual({
			cloudSessionsEnabled: false,
		});
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: false });
	});

	it("treats malformed files and non-boolean values as off", () => {
		mkdirSync(dirname(resolveDesktopSettingsPath()), { recursive: true });
		writeFileSync(resolveDesktopSettingsPath(), "{not json", "utf8");
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: false });
		writeFileSync(
			resolveDesktopSettingsPath(),
			JSON.stringify({ cloudSessionsEnabled: "yes" }),
			"utf8",
		);
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: false });
	});
});
