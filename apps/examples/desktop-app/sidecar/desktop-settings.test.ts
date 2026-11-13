import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFactoryWorkflowRecipe } from "@cline/core";
import { factoryWorkflowRecipeSchema } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FactoryPresetSettings,
	factoryPresetSchema,
} from "../webview/lib/factory-presets";
import {
	applyFactoryHandsOffUpgrade,
	type DesktopSettings,
	missingDefaultFactoryWorkflow,
	readDesktopSettings,
	resolveDefaultFactoryWorkflow,
	resolveDesktopSettingsPath,
	setCloudSessionsEnabled,
	withBuiltInFactoryPresets,
	writeDesktopSettings,
} from "./desktop-settings";
import {
	handleFactoryCommand,
	handleFactoryPresetCommand,
	handleFactorySettingsCommand,
	pushFactoryDefaultWorkflow,
} from "./factory-commands";

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
		// Keep the PR passing is a workflow setting now (E1); card-only
		// fields stay out.
		expect(readDesktopSettings().factoryPresets?.[0]?.config).toEqual({
			approval: "required",
			maxRepairRounds: 2,
			watchPullRequest: true,
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
								{
									modelSelection: { providerId: "example", modelId: "second" },
								},
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
		expect(saved).toEqual(
			withBuiltInFactoryPresets(readDesktopSettings()).factoryPresets,
		);
		await handleFactoryCommand(
			ctx,
			"factory_save_preset",
			{ name: "Second", config: {}, useByDefault: false },
			readTask,
		);
		expect(readDesktopSettings().factoryDefaultPreset).toBeUndefined();
		expect(
			readDesktopSettings().factoryPresets?.map(({ name }) => name),
		).toEqual(["First", "Second"]);
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
		// Legacy entries gain the same revision a fresh save of that config gets.
		expect(preset?.revision).toBe(
			createFactoryWorkflowRecipe({
				name: "Legacy",
				config: { agents: { implementers: [implementer] } },
			}).revision,
		);
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
			// Saving is an explicit choice the one-time upgrade must not undo.
			factoryHandsOffUpgradeApplied: true,
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

describe("Hands-off workflow and the Hub default", () => {
	const ctx = { pendingQuestions: new Map() };
	const readTask = async () => {
		throw new Error("Preset save must not access tasks");
	};

	it("makes the built-in Hands-off workflow the default only for a profile with no workflows or default", () => {
		const fresh = withBuiltInFactoryPresets(readDesktopSettings());
		expect(fresh.factoryDefaultPreset).toBe("Hands-off");
		expect(fresh.factoryPresets).toEqual([
			createFactoryWorkflowRecipe({
				name: "Hands-off",
				config: {
					autonomy: "hands_off",
					approval: "automatic",
					reviewMode: "adaptive",
					agents: fresh.factoryPresets?.[0]?.config.agents,
					maxCostUsd: 10,
					maxRepairRounds: 2,
				},
			}),
		]);
		expect(fresh.factoryPresets?.[0]?.config).toMatchObject({
			autonomy: "hands_off",
			approval: "automatic",
			// Adaptive review records each change's impact for the by-risk
			// review policy, and each card stops after $10.
			reviewMode: "adaptive",
			maxCostUsd: 10,
			agents: {
				designer: expect.anything(),
				implementers: [expect.anything()],
			},
		});
		expect(resolveDefaultFactoryWorkflow({})?.name).toBe("Hands-off");
		// Reading never writes the built-in.
		expect(readDesktopSettings()).toEqual({ cloudSessionsEnabled: false });

		const existing = createFactoryWorkflowRecipe({
			name: "Mine",
			config: { maxRepairRounds: 1 },
		});
		const other = createFactoryWorkflowRecipe({
			name: "Other",
			config: {},
		});
		const user = withBuiltInFactoryPresets({
			factoryPresets: [existing, other],
			factoryDefaultPreset: "Other",
		});
		expect(user.factoryDefaultPreset).toBe("Other");
		expect(user.factoryPresets?.map(({ name }) => name)).toEqual([
			"Mine",
			"Other",
			"Hands-off",
		]);
		// A cleared default stays cleared once the user has workflows.
		expect(
			withBuiltInFactoryPresets<FactoryPresetSettings>({
				factoryPresets: [existing],
			}).factoryDefaultPreset,
		).toBeUndefined();
		expect(resolveDefaultFactoryWorkflow({ factoryPresets: [existing] })).toBe(
			undefined,
		);
		// A user workflow named Hands-off replaces the built-in.
		const renamed = createFactoryWorkflowRecipe({
			name: "Hands-off",
			config: { maxRepairRounds: 4 },
		});
		expect(
			withBuiltInFactoryPresets({ factoryPresets: [renamed] }).factoryPresets,
		).toEqual([renamed]);
	});

	it("never adds the built-in spending limit to a saved workflow", () => {
		const legacy = createFactoryWorkflowRecipe({
			name: "Mine",
			config: { approval: "required", maxRepairRounds: 2 },
		});
		const written: DesktopSettings[] = [];
		const upgraded = applyFactoryHandsOffUpgrade(
			() => ({
				cloudSessionsEnabled: false,
				factoryPresets: [legacy],
				factoryDefaultPreset: "Mine",
			}),
			(settings) => written.push(settings),
		);
		const mine = upgraded.factoryPresets?.find(({ name }) => name === "Mine");
		expect(mine?.config.maxCostUsd).toBeUndefined();
		expect(written[0]?.factoryPresets?.[0]?.config.maxCostUsd).toBeUndefined();
		expect(
			resolveDefaultFactoryWorkflow({
				factoryPresets: [legacy],
				factoryDefaultPreset: "Mine",
			})?.config.maxCostUsd,
		).toBeUndefined();
	});

	it("keeps Hands-off as the default when a fresh profile saves its first other workflow", async () => {
		const saved = await handleFactoryCommand(
			ctx,
			"factory_save_preset",
			{ name: "Careful", config: {} },
			readTask,
		);
		expect(readDesktopSettings().factoryDefaultPreset).toBe("Hands-off");
		expect(
			readDesktopSettings().factoryPresets?.map(({ name }) => name),
		).toEqual(["Careful"]);
		expect((saved as { name: string }[]).map(({ name }) => name)).toEqual([
			"Careful",
			"Hands-off",
		]);
		expect(resolveDefaultFactoryWorkflow(readDesktopSettings())?.name).toBe(
			"Hands-off",
		);
	});

	it("round trips autonomy through save, reload, and recipe export and import", async () => {
		const setDefaults = vi.fn(async () => ({}));
		await handleFactoryCommand(
			ctx,
			"factory_save_preset",
			{
				name: "Autopilot",
				config: { autonomy: "hands_off", approval: "required" },
				useByDefault: true,
			},
			readTask,
			setDefaults,
		);
		const [preset] = readDesktopSettings().factoryPresets ?? [];
		expect(preset?.config).toMatchObject({
			autonomy: "hands_off",
			approval: "required",
		});
		expect(preset?.revision).not.toBe(
			createFactoryWorkflowRecipe({
				name: "Autopilot",
				config: { approval: "required" },
			}).revision,
		);
		const exported = factoryWorkflowRecipeSchema.parse(
			JSON.parse(
				JSON.stringify({ schemaVersion: 1, ...preset, name: "Imported" }),
			),
		);
		expect(exported.config.autonomy).toBe("hands_off");
		await handleFactoryCommand(
			ctx,
			"factory_save_preset",
			{
				name: exported.name,
				revision: exported.revision,
				config: exported.config,
			},
			readTask,
			setDefaults,
		);
		expect(readDesktopSettings().factoryPresets?.[1]).toEqual({
			...preset,
			name: "Imported",
		});
		// Dropping autonomy changes the revision, so it cannot be smuggled out.
		await expect(
			handleFactoryCommand(
				ctx,
				"factory_save_preset",
				{
					name: "Tampered",
					revision: exported.revision,
					config: { ...exported.config, autonomy: undefined },
				},
				readTask,
				setDefaults,
			),
		).rejects.toThrow("revision does not match");
	});

	it("pushes the default to the Hub on every preset save and surfaces a failed push", async () => {
		const setDefaults = vi.fn(async (_workflow: unknown) => ({}));
		await handleFactoryCommand(
			ctx,
			"factory_save_preset",
			{ name: "Focused", config: { maxRepairRounds: 1 }, useByDefault: true },
			readTask,
			setDefaults,
		);
		const focused = readDesktopSettings().factoryPresets?.[0];
		expect(setDefaults).toHaveBeenLastCalledWith({
			schemaVersion: 1,
			name: "Focused",
			revision: focused?.revision,
			config: focused?.config,
		});
		await handleFactoryCommand(
			ctx,
			"factory_save_preset",
			{ name: "Focused", config: {}, useByDefault: false },
			readTask,
			setDefaults,
		);
		expect(setDefaults).toHaveBeenLastCalledWith(null);
		expect(setDefaults).toHaveBeenCalledTimes(2);

		setDefaults.mockRejectedValueOnce(new Error("Hub unavailable"));
		await expect(
			handleFactoryCommand(
				ctx,
				"factory_save_preset",
				{ name: "Second", config: {}, useByDefault: true },
				readTask,
				setDefaults,
			),
		).rejects.toThrow(
			"Saved “Second”, but Factory could not update the default workflow for new work: Hub unavailable",
		);
		// The workflow itself is saved; saving again retries the push.
		expect(readDesktopSettings().factoryDefaultPreset).toBe("Second");
	});

	it("sends the built-in Hands-off workflow instead of failing when the chosen default is missing", async () => {
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryDefaultPreset: "Unavailable",
		});
		const setDefaults = vi.fn(async (_workflow: unknown) => ({}));
		const onInvalidDefault = vi.fn();
		// The Hub and Desktop intake resolve the same workflow.
		const intake = resolveDefaultFactoryWorkflow(readDesktopSettings());
		expect(intake).toMatchObject({
			name: "Hands-off",
			config: { autonomy: "hands_off", approval: "automatic" },
		});
		await expect(
			pushFactoryDefaultWorkflow(setDefaults, undefined, onInvalidDefault),
		).resolves.toEqual(intake);
		expect(setDefaults).toHaveBeenCalledWith(intake);
		expect(missingDefaultFactoryWorkflow(readDesktopSettings())).toContain(
			"uses the built-in Hands-off workflow",
		);
		expect(onInvalidDefault).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("“Unavailable” is missing"),
			}),
		);
		writeDesktopSettings({ cloudSessionsEnabled: false });
		await expect(
			pushFactoryDefaultWorkflow(setDefaults),
		).resolves.toMatchObject({ name: "Hands-off" });
	});
});

describe("one-time hands-off upgrade", () => {
	const legacy = () =>
		writeDesktopSettings({
			cloudSessionsEnabled: true,
			factoryDefaultPreset: "Reviewed delivery",
			factoryPresets: [
				createFactoryWorkflowRecipe({
					name: "Reviewed delivery",
					config: { approval: "required", maxRepairRounds: 1 },
				}),
				createFactoryWorkflowRecipe({ name: "Other", config: {} }),
			],
		});

	it("upgrades a legacy default to hands-off with automatic approval once", () => {
		legacy();
		const upgraded = applyFactoryHandsOffUpgrade();
		const saved = readDesktopSettings();
		expect(saved).toEqual(upgraded);
		expect(saved.factoryHandsOffUpgradeApplied).toBe(true);
		expect(saved.cloudSessionsEnabled).toBe(true);
		const [reviewed, other] = saved.factoryPresets ?? [];
		expect(reviewed?.config).toMatchObject({
			autonomy: "hands_off",
			approval: "automatic",
			maxRepairRounds: 1,
		});
		// The revision follows the upgraded config, so the Hub sees a new recipe.
		expect(reviewed?.revision).toBe(
			createFactoryWorkflowRecipe({
				name: "Reviewed delivery",
				config: reviewed?.config ?? {},
			}).revision,
		);
		// Only the default is upgraded.
		expect(other?.config).not.toHaveProperty("autonomy");
		expect(resolveDefaultFactoryWorkflow(saved)?.config).toMatchObject({
			autonomy: "hands_off",
			approval: "automatic",
		});
	});

	it("respects a default turned back to manual after the upgrade", () => {
		legacy();
		applyFactoryHandsOffUpgrade();
		const settings = readDesktopSettings();
		writeDesktopSettings({
			...settings,
			factoryPresets: [
				createFactoryWorkflowRecipe({
					name: "Reviewed delivery",
					config: { approval: "required" },
				}),
			],
		});
		const write = vi.fn();
		const kept = applyFactoryHandsOffUpgrade(readDesktopSettings, write);
		expect(write).not.toHaveBeenCalled();
		expect(kept.factoryPresets?.[0]?.config).not.toHaveProperty("autonomy");
		expect(kept.factoryPresets?.[0]?.config.approval).toBe("required");
	});

	it("marks a profile whose default is already hands-off without changing it", () => {
		const preset = createFactoryWorkflowRecipe({
			name: "Mine",
			config: { autonomy: "hands_off", approval: "required" },
		});
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryDefaultPreset: "Mine",
			factoryPresets: [preset],
		});
		const result = applyFactoryHandsOffUpgrade();
		expect(result.factoryPresets).toEqual([preset]);
		expect(readDesktopSettings().factoryHandsOffUpgradeApplied).toBe(true);
	});

	it("leaves a fresh profile unwritten; it already uses the built-in Hands-off default", () => {
		const write = vi.fn();
		expect(applyFactoryHandsOffUpgrade(readDesktopSettings, write)).toEqual({
			cloudSessionsEnabled: false,
		});
		expect(write).not.toHaveBeenCalled();
	});

	it("marks the upgrade applied when the user saves a workflow", async () => {
		await handleFactoryCommand(
			{ pendingQuestions: new Map() },
			"factory_save_preset",
			{ name: "Manual", config: {}, useByDefault: true },
			async () => {
				throw new Error("Preset save must not access tasks");
			},
		);
		const write = vi.fn();
		const kept = applyFactoryHandsOffUpgrade(readDesktopSettings, write);
		expect(write).not.toHaveBeenCalled();
		expect(kept.factoryPresets?.[0]?.config).not.toHaveProperty("autonomy");
	});
});

describe("saved workflows: delete and rename", () => {
	const focused = createFactoryWorkflowRecipe({
		name: "Focused",
		config: { approval: "required", maxRepairRounds: 1 },
	});
	const careful = createFactoryWorkflowRecipe({
		name: "Careful",
		config: { approval: "required", maxRepairRounds: 3 },
	});

	it("never deletes the built-in workflow, and the default only with another chosen", async () => {
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryDefaultPreset: "Focused",
			factoryPresets: [focused, careful],
		});
		const pushed = vi.fn(async () => ({}));
		await expect(
			handleFactoryPresetCommand(
				"factory_delete_preset",
				{ name: "Hands-off" },
				pushed,
			),
		).rejects.toThrow("built in");
		await expect(
			handleFactoryPresetCommand(
				"factory_delete_preset",
				{ name: "Focused" },
				pushed,
			),
		).rejects.toThrow("Choose another default");
		await expect(
			handleFactoryPresetCommand(
				"factory_delete_preset",
				{ name: "Careful", newDefault: "Focused" },
				pushed,
			),
		).rejects.toThrow("only for deleting the default");
		await expect(
			handleFactoryPresetCommand(
				"factory_delete_preset",
				{ name: "Missing" },
				pushed,
			),
		).rejects.toThrow("no saved workflow");
		expect(readDesktopSettings().factoryPresets).toHaveLength(2);
		expect(pushed).not.toHaveBeenCalled();

		// Deleting a workflow that is not the default changes nothing else.
		const listed = (await handleFactoryPresetCommand(
			"factory_delete_preset",
			{ name: "Careful" },
			pushed,
		)) as Array<{ name: string }>;
		expect(listed.map((item) => item.name)).toEqual(["Focused", "Hands-off"]);
		expect(pushed).not.toHaveBeenCalled();
		// The default goes once another is chosen, and the Hub learns it.
		await handleFactoryPresetCommand(
			"factory_delete_preset",
			{ name: "Focused", newDefault: "Hands-off" },
			pushed,
		);
		expect(readDesktopSettings()).toMatchObject({
			factoryDefaultPreset: "Hands-off",
			factoryPresets: [],
		});
		expect(pushed).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Hands-off" }),
		);
	});

	it("renames keeping the revision and moving the default with it", async () => {
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryDefaultPreset: "Focused",
			factoryPresets: [focused, careful],
		});
		const pushed = vi.fn(async () => ({}));
		await expect(
			handleFactoryPresetCommand(
				"factory_rename_preset",
				{ name: "Focused", newName: "Careful" },
				pushed,
			),
		).rejects.toThrow("already exists");
		await expect(
			handleFactoryPresetCommand(
				"factory_rename_preset",
				{ name: "Focused", newName: "Hands-off" },
				pushed,
			),
		).rejects.toThrow("built in");
		await handleFactoryPresetCommand(
			"factory_rename_preset",
			{ name: "Focused", newName: "Small fixes" },
			pushed,
		);
		const settings = readDesktopSettings();
		expect(settings.factoryDefaultPreset).toBe("Small fixes");
		expect(settings.factoryPresets?.[0]).toMatchObject({
			name: "Small fixes",
			revision: focused.revision,
			config: focused.config,
		});
		expect(pushed).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Small fixes",
				revision: focused.revision,
			}),
		);
	});

	it("resets Factory settings: Hands-off becomes the default, saved workflows stay", async () => {
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryDefaultPreset: "Focused",
			factoryPresets: [focused],
		});
		const pushed = vi.fn(async () => ({}));
		const send = vi.fn(async () => ({
			ok: true,
			payload: {
				what: "settings",
				dryRun: false,
				concurrency: 2,
				dailyCostUsd: 50,
			},
		}));
		await expect(
			handleFactorySettingsCommand(
				"factory_reset",
				{ what: "settings" },
				send,
				pushed,
			),
		).resolves.toMatchObject({ supported: true, ok: true, concurrency: 2 });
		expect(send).toHaveBeenCalledWith("task.factory.reset", {
			what: "settings",
		});
		expect(readDesktopSettings()).toMatchObject({
			factoryDefaultPreset: "Hands-off",
			factoryPresets: [{ name: "Focused" }],
		});
		expect(pushed).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Hands-off" }),
		);
		// A dry run only counts.
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryDefaultPreset: "Focused",
			factoryPresets: [focused],
		});
		await handleFactorySettingsCommand(
			"factory_reset",
			{ what: "settings", dryRun: true },
			vi.fn(async () => ({
				ok: true,
				payload: { what: "settings", dryRun: true },
			})),
			pushed,
		);
		expect(readDesktopSettings().factoryDefaultPreset).toBe("Focused");
	});
});
