import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readFileSyncStrippingUtf8Bom } from "@cline/shared/node";
import { resolveClineDataDir } from "@cline/shared/storage";

export type DesktopSettings = {
	cloudAgentsEnabled: boolean;
};

type DesktopSettingsFile = {
	version: 1;
	cloudAgentsEnabled?: boolean;
	[key: string]: unknown;
};

export function resolveDesktopSettingsPath(): string {
	return join(
		resolveClineDataDir(),
		"settings",
		"clients",
		"desktop",
		"preferences.json",
	);
}

function readDesktopSettingsFile(): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(
			readFileSyncStrippingUtf8Bom(resolveDesktopSettingsPath()),
		);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

export function readDesktopSettings(): DesktopSettings {
	return {
		cloudAgentsEnabled: readDesktopSettingsFile().cloudAgentsEnabled !== false,
	};
}

export function writeDesktopSettings(
	patch: Partial<DesktopSettings>,
): DesktopSettings {
	const next: DesktopSettingsFile = {
		...readDesktopSettingsFile(),
		...patch,
		version: 1,
	};
	const filePath = resolveDesktopSettingsPath();
	mkdirSync(dirname(filePath), { recursive: true });
	// Avoid leaving a torn file if the process exits mid-write.
	const tempPath = `${filePath}.${process.pid}.tmp`;
	writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	renameSync(tempPath, filePath);
	return readDesktopSettings();
}
