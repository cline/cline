import type { StatusSnapshot, StatusSnapshotSource } from "./status-snapshot-source";

export function createFallbackStatusSnapshotSource(
	primary: StatusSnapshotSource,
	fallback: StatusSnapshotSource,
): StatusSnapshotSource {
	return {
		async load(): Promise<StatusSnapshot> {
			let primaryError: unknown;
			try {
				const snap = await primary.load();
				if (snap.updates.length > 0 || snap.teams.length > 0) {
					return snap;
				}
			} catch (error) {
				primaryError = error;
			}

			try {
				return await fallback.load();
			} catch (fallbackError) {
				if (primaryError !== undefined) {
					throw primaryError;
				}
				throw fallbackError;
			}
		},
	};
}
