import { describe, expect, it } from "vitest";
import {
	migrateSessionReplayBundleManifest,
	readSessionReplayBundleSchemaVersion,
	SESSION_REPLAY_BUNDLE_MIGRATIONS,
	SessionReplayBundleError,
	type SessionReplayBundleMigration,
	SessionReplayBundleVersionError,
} from "./bundle-migrations";
import { SESSION_REPLAY_BUNDLE_FORMAT } from "./bundle-schema";

function rawManifest(schemaVersion: unknown, extra: object = {}) {
	return { format: SESSION_REPLAY_BUNDLE_FORMAT, schemaVersion, ...extra };
}

const FAKE_MIGRATIONS: SessionReplayBundleMigration[] = [
	{
		from: 1,
		to: 2,
		description: "rename files to entries",
		migrate: ({ files, ...rest }) => ({ ...rest, entries: files }),
	},
	{
		from: 2,
		to: 3,
		description: "add environment",
		migrate: (manifest) => ({ ...manifest, environment: {} }),
	},
];

describe("session replay bundle migrations", () => {
	it("has no migrations at schema version 1", () => {
		expect(SESSION_REPLAY_BUNDLE_MIGRATIONS).toEqual([]);
		expect(migrateSessionReplayBundleManifest(rawManifest(1))).toEqual({
			manifest: rawManifest(1),
			fromVersion: 1,
			applied: [],
		});
	});

	it("applies migrations in order up to the target version", () => {
		const result = migrateSessionReplayBundleManifest(
			rawManifest(1, { files: ["a"] }),
			{ migrations: FAKE_MIGRATIONS, targetVersion: 3 },
		);
		expect(result.fromVersion).toBe(1);
		expect(result.applied).toEqual([
			"rename files to entries",
			"add environment",
		]);
		expect(result.manifest).toEqual({
			format: SESSION_REPLAY_BUNDLE_FORMAT,
			schemaVersion: 3,
			entries: ["a"],
			environment: {},
		});

		const partial = migrateSessionReplayBundleManifest(rawManifest(2), {
			migrations: FAKE_MIGRATIONS,
			targetVersion: 3,
		});
		expect(partial.applied).toEqual(["add environment"]);
	});

	it("fails when a migration step is missing", () => {
		expect(() =>
			migrateSessionReplayBundleManifest(rawManifest(1), {
				migrations: FAKE_MIGRATIONS.slice(1),
				targetVersion: 3,
			}),
		).toThrow("No migration from session replay bundle schemaVersion 1 to 2.");
	});

	it("refuses newer bundles with a clear error", () => {
		let caught: unknown;
		try {
			migrateSessionReplayBundleManifest(rawManifest(5));
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(SessionReplayBundleVersionError);
		expect(caught).toMatchObject({ bundleVersion: 5, supportedVersion: 1 });
		expect((caught as Error).message).toBe(
			"Session replay bundle uses schemaVersion 5, but this version of Cline reads bundles up to schemaVersion 1. Upgrade Cline to read this bundle.",
		);
	});

	it("rejects manifests that are not bundles or carry invalid versions", () => {
		expect(() => readSessionReplayBundleSchemaVersion([])).toThrow(
			"manifest is not a JSON object",
		);
		expect(() =>
			readSessionReplayBundleSchemaVersion({ schemaVersion: 1 }),
		).toThrow("Not a session replay bundle");
		for (const version of ["1", 1.5, 0]) {
			let caught: unknown;
			try {
				readSessionReplayBundleSchemaVersion(rawManifest(version));
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(SessionReplayBundleError);
			expect(caught).not.toBeInstanceOf(SessionReplayBundleVersionError);
		}
	});
});
