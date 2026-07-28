import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
	BUILTIN_PROVIDER_MANIFESTS,
	DRIVE_PROVIDER_MANIFEST_FILE_NAME,
	parseDriveProviderManifest,
	resolveDriveProvidersDir,
	type DriveProviderManifest,
	type DriveProviderOrigin,
} from "@cline/shared";

export interface LoadDriveProviderRegistryInput {
	workspaceRoot?: string;
	userConfigParent?: string;
}

/**
 * Load builtin manifests plus workspace/user drop-in provider manifests.
 * Invalid manifests are skipped (logged by caller if needed).
 */
export function loadDriveProviderRegistry(
	input: LoadDriveProviderRegistryInput = {},
): DriveProviderManifest[] {
	const byId = new Map<string, DriveProviderManifest>();
	for (const manifest of BUILTIN_PROVIDER_MANIFESTS) {
		byId.set(manifest.id, manifest);
	}

	if (input.userConfigParent) {
		for (const manifest of readProviderDir(
			input.userConfigParent,
			"user",
		)) {
			byId.set(manifest.id, manifest);
		}
	}
	if (input.workspaceRoot) {
		for (const manifest of readProviderDir(
			input.workspaceRoot,
			"workspace",
		)) {
			byId.set(manifest.id, manifest);
		}
	}

	return [...byId.values()];
}

function readProviderDir(
	configParent: string,
	origin: DriveProviderOrigin,
): DriveProviderManifest[] {
	const dir = resolveDriveProvidersDir(configParent);
	if (!existsSync(dir)) {
		return [];
	}
	const entries = readdirSync(dir, { withFileTypes: true });
	const manifests: DriveProviderManifest[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const manifestPath = join(
			dir,
			entry.name,
			DRIVE_PROVIDER_MANIFEST_FILE_NAME,
		);
		if (!existsSync(manifestPath)) {
			continue;
		}
		try {
			const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
			const parsed = parseDriveProviderManifest(raw);
			manifests.push({
				...parsed,
				origin,
				id: parsed.id || entry.name,
			});
		} catch {
			// Skip invalid manifests; hub ops can surface errors later.
		}
	}
	return manifests;
}
