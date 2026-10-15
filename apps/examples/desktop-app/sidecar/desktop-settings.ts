import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";
import { z } from "zod";
import {
	type FactoryPreset,
	factoryPresetSchema,
} from "../webview/lib/factory-presets";

/** Desktop-only preferences kept separate from strict shared global settings. */
export type DesktopSettings = {
	/** Opt-in gate for cloud sessions while the feature is in preview. */
	cloudSessionsEnabled: boolean;
	factoryPresets?: FactoryPreset[];
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
				factoryPresets: z
					.array(z.unknown())
					.transform((items) =>
						items.flatMap((item) => {
							const result = factoryPresetSchema.safeParse(item);
							return result.success ? [result.data] : [];
						}),
					)
					.optional()
					.catch(undefined),
			})
			.parse(JSON.parse(raw));
		return {
			cloudSessionsEnabled: parsed.cloudSessionsEnabled === true,
			...(parsed.factoryPresets
				? { factoryPresets: parsed.factoryPresets }
				: {}),
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
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
