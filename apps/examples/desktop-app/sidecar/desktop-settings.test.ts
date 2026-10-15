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
	it("excludes feature documents and source issues from saved presets", () => {
		const preset = factoryPresetSchema.parse({
			name: "Clean",
			config: {
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
	});

	it("round trips local presets and preserves them when changing cloud preferences", async () => {
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryPresets: [
				{
					name: "Focused",
					config: {
						approval: "required",
						maxRepairRounds: 1,
						agents: {
							designer: {},
							planReviewers: [{}],
							implementer: { instructions: "Small changes" },
							reviewers: [{}],
						},
					},
				},
			],
		});
		const settings = readDesktopSettings();
		expect(
			settings.factoryPresets?.[0]?.config.agents?.implementer.instructions,
		).toBe("Small changes");
		expect(setCloudSessionsEnabled(true).factoryPresets).toEqual(
			settings.factoryPresets,
		);
		await handleFactoryCommand(
			{ pendingQuestions: new Map() },
			"factory_save_preset",
			{ name: "Second", config: {} },
			async () => {
				throw new Error("Preset save must not access tasks");
			},
		);
		expect(readDesktopSettings().cloudSessionsEnabled).toBe(true);
		expect(
			readDesktopSettings().factoryPresets?.map((preset) => preset.name),
		).toEqual(["Focused", "Second"]);
	});

	it("keeps valid presets when another saved preset is invalid, including after a save", async () => {
		mkdirSync(dirname(resolveDesktopSettingsPath()), { recursive: true });
		writeFileSync(
			resolveDesktopSettingsPath(),
			JSON.stringify({
				cloudSessionsEnabled: true,
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
		expect(saved.factoryPresets?.map((preset) => preset.name)).toEqual([
			"Valid",
			"New",
		]);
		expect(readFileSync(resolveDesktopSettingsPath(), "utf8")).not.toContain(
			"Broken",
		);
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
