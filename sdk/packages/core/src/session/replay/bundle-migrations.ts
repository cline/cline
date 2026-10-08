import {
	SESSION_REPLAY_BUNDLE_FORMAT,
	SESSION_REPLAY_BUNDLE_SCHEMA_VERSION,
} from "./bundle-schema";

export class SessionReplayBundleError extends Error {
	constructor(
		message: string,
		readonly issues: readonly string[] = [],
	) {
		super(
			issues.length > 0
				? `${message}\n${issues.map((issue) => `  - ${issue}`).join("\n")}`
				: message,
		);
		this.name = "SessionReplayBundleError";
	}
}

/** Raised when a bundle's schemaVersion is newer than this build can read. */
export class SessionReplayBundleVersionError extends SessionReplayBundleError {
	constructor(
		readonly bundleVersion: number,
		readonly supportedVersion: number,
	) {
		super(
			`Session replay bundle uses schemaVersion ${bundleVersion}, but this version of Cline reads bundles up to schemaVersion ${supportedVersion}. Upgrade Cline to read this bundle.`,
		);
		this.name = "SessionReplayBundleVersionError";
	}
}

/**
 * Upgrades a manifest from schema version `from` to `to` (= from + 1).
 *
 * Migrations run on the parsed manifest before validation. A migration that
 * changes file contents must record that in the manifest (e.g. a new file
 * kind) so readers know how to interpret older files; bundles on disk are
 * never rewritten by a reader.
 */
export interface SessionReplayBundleMigration {
	from: number;
	to: number;
	description: string;
	migrate(manifest: Record<string, unknown>): Record<string, unknown>;
}

/** Ordered migrations, one per schema version bump. */
export const SESSION_REPLAY_BUNDLE_MIGRATIONS: readonly SessionReplayBundleMigration[] =
	[
		{
			from: 1,
			to: 2,
			description:
				"1 → 2: sessions gain `recording` (null: version 1 bundles carry no recordings)",
			migrate(manifest) {
				const sessions = Array.isArray(manifest.sessions)
					? manifest.sessions.map((session: unknown) =>
							isRecord(session) && !("recording" in session)
								? { ...session, recording: null }
								: session,
						)
					: manifest.sessions;
				return { ...manifest, sessions };
			},
		},
	];

export interface MigrateSessionReplayBundleManifestOptions {
	migrations?: readonly SessionReplayBundleMigration[];
	targetVersion?: number;
}

export interface MigratedSessionReplayBundleManifest {
	manifest: Record<string, unknown>;
	fromVersion: number;
	/** Descriptions of the migrations that ran, in order. */
	applied: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads `schemaVersion` from a raw manifest, refusing anything that is not a
 * session replay bundle or is newer than `supportedVersion`.
 */
export function readSessionReplayBundleSchemaVersion(
	raw: unknown,
	supportedVersion = SESSION_REPLAY_BUNDLE_SCHEMA_VERSION,
): number {
	if (!isRecord(raw)) {
		throw new SessionReplayBundleError(
			"Not a session replay bundle: manifest is not a JSON object.",
		);
	}
	if (raw.format !== SESSION_REPLAY_BUNDLE_FORMAT) {
		throw new SessionReplayBundleError(
			`Not a session replay bundle: manifest format is ${JSON.stringify(raw.format)}, expected "${SESSION_REPLAY_BUNDLE_FORMAT}".`,
		);
	}
	const version = raw.schemaVersion;
	if (typeof version !== "number" || !Number.isInteger(version)) {
		throw new SessionReplayBundleError(
			`Invalid session replay bundle: schemaVersion must be an integer, got ${JSON.stringify(version)}.`,
		);
	}
	if (version < 1) {
		throw new SessionReplayBundleError(
			`Invalid session replay bundle: schemaVersion ${version} is not a known version.`,
		);
	}
	if (version > supportedVersion) {
		throw new SessionReplayBundleVersionError(version, supportedVersion);
	}
	return version;
}

/**
 * Brings a raw manifest up to `targetVersion` (default: the current schema
 * version) by applying migrations in order. Newer bundles are refused with
 * {@link SessionReplayBundleVersionError}; a missing step is an error.
 */
export function migrateSessionReplayBundleManifest(
	raw: unknown,
	options: MigrateSessionReplayBundleManifestOptions = {},
): MigratedSessionReplayBundleManifest {
	const migrations = options.migrations ?? SESSION_REPLAY_BUNDLE_MIGRATIONS;
	const targetVersion =
		options.targetVersion ?? SESSION_REPLAY_BUNDLE_SCHEMA_VERSION;
	const fromVersion = readSessionReplayBundleSchemaVersion(raw, targetVersion);
	let manifest = { ...(raw as Record<string, unknown>) };
	let version = fromVersion;
	const applied: string[] = [];
	while (version < targetVersion) {
		const step = migrations.find((migration) => migration.from === version);
		if (!step || step.to !== version + 1) {
			throw new SessionReplayBundleError(
				`No migration from session replay bundle schemaVersion ${version} to ${version + 1}.`,
			);
		}
		manifest = { ...step.migrate(manifest), schemaVersion: step.to };
		applied.push(step.description);
		version = step.to;
	}
	return { manifest, fromVersion, applied };
}
