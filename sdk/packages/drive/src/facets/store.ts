/**
 * Pure facet store over a durable disk snapshot + live memory layer.
 * No fs, no sockets, no participants[] — hub commits separately.
 */

import type { DriveFacetDiskSnapshot } from "@cline/shared";
import {
	DRIVE_FACET_CATALOG,
	type DriveFacetKey,
	type DriveFacetValue,
	listFacetDefs,
} from "./catalog";

export type FacetStoreSnapshot = {
	readonly durable: DriveFacetDiskSnapshot;
	readonly live: Readonly<Partial<Record<DriveFacetKey, unknown>>>;
};

export type FacetStore = {
	get<K extends DriveFacetKey>(
		key: K,
		instanceId?: string,
	): DriveFacetValue<K>;
	/** Update live-lane values only (durable writes go through hub IO). */
	setLive<K extends DriveFacetKey>(
		key: K,
		value: DriveFacetValue<K>,
	): void;
	listDefs: typeof listFacetDefs;
	/** Replace durable snapshot. live_wins keys are preserved. */
	reload(disk: DriveFacetDiskSnapshot): void;
	/** Copy durable defaults into live at room creation (seed once). */
	seedLiveFromDurable(): void;
	snapshot(): FacetStoreSnapshot;
};

export function createFacetStore(
	initial?: DriveFacetDiskSnapshot,
): FacetStore {
	let durable: DriveFacetDiskSnapshot = initial ?? {
		schemaVersion: 1,
		values: {},
		maps: {},
	};
	let live: Partial<Record<DriveFacetKey, unknown>> = {};

	const get = <K extends DriveFacetKey>(
		key: K,
		instanceId?: string,
	): DriveFacetValue<K> => {
		const def = DRIVE_FACET_CATALOG[key];

		if (def.lane === "live") {
			if (key in live) {
				return live[key] as DriveFacetValue<K>;
			}
			return def.defaultValue as DriveFacetValue<K>;
		}

		if (key === "agent.appearance") {
			const id = instanceId ?? "builtin.pair_partner";
			const fromMap = durable.maps["agent.appearance"]?.[id];
			if (fromMap !== undefined) {
				return fromMap as DriveFacetValue<K>;
			}
			return def.defaultValue as DriveFacetValue<K>;
		}

		if (key in durable.values) {
			return durable.values[key] as DriveFacetValue<K>;
		}
		return def.defaultValue as DriveFacetValue<K>;
	};

	return {
		get,
		setLive(key, value) {
			const def = DRIVE_FACET_CATALOG[key];
			if (def.lane !== "live") {
				throw new Error(
					`setLive only applies to live facets; "${key}" is ${def.lane}`,
				);
			}
			live = { ...live, [key]: value };
		},
		listDefs: listFacetDefs,
		reload(disk) {
			durable = disk;
			// live_wins: do not clear or overwrite live values from disk
		},
		seedLiveFromDurable() {
			const seeded = get("drive.defaults.subMode");
			live = {
				...live,
				"room.live.subMode": seeded,
			};
		},
		snapshot() {
			return { durable, live: { ...live } };
		},
	};
}
