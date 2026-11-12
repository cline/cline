import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createFactoryWorkflowRecipe } from "@cline/core";
import type { FactoryWorkflowRecipe } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import { z } from "zod";
import {
	type FactoryPresetSettings,
	factoryPresetSchema,
	HANDS_OFF_PRESET_CONFIG,
	HANDS_OFF_PRESET_NAME,
} from "../webview/lib/factory-presets";

/** Desktop-only preferences kept separate from strict shared global settings. */
export type DesktopSettings = FactoryPresetSettings & {
	/** Opt-in gate for cloud sessions while the feature is in preview. */
	cloudSessionsEnabled: boolean;
	/**
	 * Set once the one-time hands-off upgrade of a legacy default workflow has
	 * run (see `applyFactoryHandsOffUpgrade`), so a default the user later turns
	 * back to manual stays manual.
	 */
	factoryHandsOffUpgradeApplied?: boolean;
};

const DEFAULT_SETTINGS: DesktopSettings = {
	cloudSessionsEnabled: false,
};

export function resolveDesktopSettingsPath(): string {
	return join(resolveClineDataDir(), "settings", "code-settings.json");
}

export function readDesktopSettings(): DesktopSettings {
	let raw: string;
	try {
		raw = readFileSync(resolveDesktopSettingsPath(), "utf8");
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
	try {
		const parsed = z
			.object({
				cloudSessionsEnabled: z.unknown().optional(),
				factoryHandsOffUpgradeApplied: z.unknown().optional(),
				factoryDefaultPreset: factoryPresetSchema.shape.name
					.optional()
					.catch(undefined),
				factoryPresets: z
					.array(z.unknown())
					.transform((items) =>
						items.flatMap((item) => {
							const result = factoryPresetSchema.safeParse(item);
							// Recompute revisions so legacy and hand-edited entries stay honest.
							return result.success
								? [createFactoryWorkflowRecipe(result.data)]
								: [];
						}),
					)
					.optional()
					.catch(undefined),
			})
			.parse(JSON.parse(raw));
		return {
			cloudSessionsEnabled: parsed.cloudSessionsEnabled === true,
			...(parsed.factoryHandsOffUpgradeApplied === true
				? { factoryHandsOffUpgradeApplied: true }
				: {}),
			...(parsed.factoryDefaultPreset
				? { factoryDefaultPreset: parsed.factoryDefaultPreset }
				: {}),
			...(parsed.factoryPresets
				? { factoryPresets: parsed.factoryPresets }
				: {}),
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

/**
 * Saved settings plus the built-in Hands-off workflow. It is listed after the
 * user's own presets unless one of them shares its name, and is the default
 * only for a profile that has saved no workflow and chosen no default. Never
 * persisted on its own, so existing presets and defaults are left untouched.
 */
export function withBuiltInFactoryPresets<
	Settings extends FactoryPresetSettings,
>(settings: Settings): Settings {
	const saved = settings.factoryPresets ?? [];
	const fresh = saved.length === 0 && !settings.factoryDefaultPreset;
	return {
		...settings,
		factoryPresets: saved.some((item) => item.name === HANDS_OFF_PRESET_NAME)
			? saved
			: [
					...saved,
					createFactoryWorkflowRecipe({
						name: HANDS_OFF_PRESET_NAME,
						config: HANDS_OFF_PRESET_CONFIG,
					}),
				],
		...(fresh ? { factoryDefaultPreset: HANDS_OFF_PRESET_NAME } : {}),
	};
}

/**
 * Why the chosen default workflow cannot be used: it is missing, or it was
 * filtered out on read as invalid. New work then uses the built-in Hands-off
 * workflow; Factory → Workflows says so.
 */
export function missingDefaultFactoryWorkflow(
	saved: FactoryPresetSettings,
): string | undefined {
	const settings = withBuiltInFactoryPresets(saved);
	const name = settings.factoryDefaultPreset;
	if (!name || settings.factoryPresets?.some((item) => item.name === name))
		return undefined;
	return `Default workflow “${name}” is missing or invalid, so new work uses the built-in ${HANDS_OFF_PRESET_NAME} workflow. Choose a saved workflow or save a replacement in Factory → Workflows.`;
}

/**
 * The workflow new Factory work uses: the saved default, Hands-off for a
 * profile that never chose one or whose chosen default is missing or invalid
 * (see `missingDefaultFactoryWorkflow`), or Factory's default policy when the
 * default was cleared. Desktop intake and the Hub default both use this, so
 * work started anywhere follows the same workflow.
 */
export function resolveDefaultFactoryWorkflow(
	saved: FactoryPresetSettings,
): FactoryWorkflowRecipe | undefined {
	const settings = withBuiltInFactoryPresets(saved);
	const name = settings.factoryDefaultPreset;
	if (!name) return undefined;
	const preset =
		settings.factoryPresets?.find((item) => item.name === name) ??
		settings.factoryPresets?.find(
			(item) => item.name === HANDS_OFF_PRESET_NAME,
		);
	return preset ? createFactoryWorkflowRecipe(preset) : undefined;
}

/**
 * One-time upgrade for profiles saved before hands-off existed: a default
 * workflow that predates the `autonomy` field becomes hands-off with automatic
 * plan approval, so existing users run work to a draft PR without setup. The
 * flag is persisted with the first check, so a default the user later turns
 * back to manual is never upgraded again. Returns the settings to use; writes
 * only when there is a saved profile to mark.
 */
export function applyFactoryHandsOffUpgrade(
	read: () => DesktopSettings = readDesktopSettings,
	write: (settings: DesktopSettings) => void = writeDesktopSettings,
): DesktopSettings {
	const settings = read();
	if (settings.factoryHandsOffUpgradeApplied) return settings;
	// A fresh profile already runs the built-in Hands-off default; its first
	// saved workflow marks the upgrade as applied.
	if (!settings.factoryDefaultPreset && !settings.factoryPresets?.length)
		return settings;
	const name = settings.factoryDefaultPreset;
	const legacy = settings.factoryPresets?.find(
		(preset) => preset.name === name && preset.config.autonomy === undefined,
	);
	const next: DesktopSettings = {
		...settings,
		...(legacy
			? {
					factoryPresets: settings.factoryPresets?.map((preset) =>
						preset === legacy
							? createFactoryWorkflowRecipe({
									name: preset.name,
									config: {
										...preset.config,
										autonomy: "hands_off",
										approval: "automatic",
									},
								})
							: preset,
					),
				}
			: {}),
		factoryHandsOffUpgradeApplied: true,
	};
	write(next);
	return next;
}

export function writeDesktopSettings(settings: DesktopSettings): void {
	const filePath = resolveDesktopSettingsPath();
	mkdirSync(dirname(filePath), { recursive: true });
	// Avoid leaving torn settings if the process exits mid-write.
	const tempPath = `${filePath}.${process.pid}.tmp`;
	writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	renameSync(tempPath, filePath);
}

export function setCloudSessionsEnabled(enabled: boolean): DesktopSettings {
	const next = { ...readDesktopSettings(), cloudSessionsEnabled: enabled };
	writeDesktopSettings(next);
	return next;
}
