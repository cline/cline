/**
 * Durable Drive registry IO (registry.v1.json) — packs under drive-config tree.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	type DriveRegistry,
	emptyDriveRegistry,
	lookupRosterPack,
	parseDriveRegistry,
	type RosterPack,
	resolveDriveRegistryPath,
} from "@cline/shared";

export function readDriveRegistryFile(
	configParent: string,
): DriveRegistry | null {
	const path = resolveDriveRegistryPath(configParent);
	if (!existsSync(path)) {
		return null;
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
	return parseDriveRegistry(raw);
}

export function writeDriveRegistryFile(
	configParent: string,
	registry: DriveRegistry,
): void {
	const path = resolveDriveRegistryPath(configParent);
	mkdirSync(dirname(path), { recursive: true });
	const tmp = join(dirname(path), `.registry.v1.${process.pid}.tmp.json`);
	writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

export function loadOrEmptyDriveRegistry(configParent: string): DriveRegistry {
	return readDriveRegistryFile(configParent) ?? emptyDriveRegistry();
}

export function resolvePackFromRegistry(
	configParent: string,
	packIdOrSlug: string,
): RosterPack | null {
	const registry = readDriveRegistryFile(configParent);
	if (!registry) {
		return null;
	}
	return lookupRosterPack(registry, packIdOrSlug);
}

export { lookupRosterPack };
