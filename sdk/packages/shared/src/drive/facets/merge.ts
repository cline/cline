/**
 * Workspace-over-user facet merge with explicit tombstones.
 * File absence means inherit; tombstone hides the lower scope.
 */

import type { DriveFacetDiskFile, DriveFacetDiskSnapshot } from "./schemas";
import { DRIVE_FACET_SCHEMA_VERSION } from "./types";

function mergeScalarOrTombstone(
	user: { kind: "value"; value: unknown } | { kind: "tombstone" } | undefined,
	workspace:
		| { kind: "value"; value: unknown }
		| { kind: "tombstone" }
		| undefined,
): { kind: "value"; value: unknown } | { kind: "tombstone" } | undefined {
	if (workspace) {
		return workspace;
	}
	return user;
}

/**
 * Merge user + workspace facet files.
 * Workspace overlays user per key / map entity id.
 * A workspace tombstone hides the user value; absence inherits.
 */
export function mergeFacetScopes(
	user: DriveFacetDiskFile | null | undefined,
	workspace: DriveFacetDiskFile | null | undefined,
): DriveFacetDiskSnapshot {
	const userEntries = user?.entries ?? {};
	const workspaceEntries = workspace?.entries ?? {};
	const keys = new Set([
		...Object.keys(userEntries),
		...Object.keys(workspaceEntries),
	]);

	const values: Record<string, unknown> = {};
	const maps: Record<string, Record<string, unknown>> = {};

	for (const key of keys) {
		const u = userEntries[key];
		const w = workspaceEntries[key];

		const uIsMap = u?.kind === "map";
		const wIsMap = w?.kind === "map";

		if (uIsMap || wIsMap) {
			const userMap = u?.kind === "map" ? u.entries : {};
			const workspaceMap = w?.kind === "map" ? w.entries : {};
			const entityIds = new Set([
				...Object.keys(userMap),
				...Object.keys(workspaceMap),
			]);
			const mergedMap: Record<string, unknown> = {};
			for (const id of entityIds) {
				const merged = mergeScalarOrTombstone(
					userMap[id],
					workspaceMap[id],
				);
				if (merged?.kind === "value") {
					mergedMap[id] = merged.value;
				}
				// tombstone or absence → omit (hidden / inherit-nothing)
			}
			maps[key] = mergedMap;
			continue;
		}

		const merged = mergeScalarOrTombstone(
			u?.kind === "value" || u?.kind === "tombstone" ? u : undefined,
			w?.kind === "value" || w?.kind === "tombstone" ? w : undefined,
		);
		if (merged?.kind === "value") {
			values[key] = merged.value;
		}
	}

	return {
		schemaVersion: DRIVE_FACET_SCHEMA_VERSION,
		values,
		maps,
	};
}

export function emptyFacetDiskSnapshot(): DriveFacetDiskSnapshot {
	return {
		schemaVersion: DRIVE_FACET_SCHEMA_VERSION,
		values: {},
		maps: {},
	};
}
