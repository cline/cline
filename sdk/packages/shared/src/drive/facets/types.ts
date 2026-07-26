/**
 * Drive facet catalog types (DRV-PLATFORM-CONFIG).
 *
 * Lanes: durable (disk) | live (hub memory) | ephemeral (client-only).
 * Privacy class `forbidden` has no facet — rejected by event schemas.
 */

export type FacetOwner = "hub" | "kernel" | "webview" | "cli";

export type FacetScope = "user" | "workspace" | "room" | "session";

export type FacetLane = "durable" | "live" | "ephemeral";

export type PrivacyClass = "public" | "sensitive" | "forbidden";

export type ConflictRule =
	| "workspace_over_user"
	| "user_only"
	| "live_wins";

export type FacetPhase = 0 | 1 | 2 | 3 | 4;

/**
 * Declaration shape. Concrete catalogs live in `@cline/drive`;
 * Zod schemas for boundary parse live beside this module.
 */
export type FacetDefMeta<T> = {
	readonly id: string;
	readonly title: string;
	readonly owner: FacetOwner;
	readonly scope: FacetScope;
	readonly lane: FacetLane;
	readonly privacy: PrivacyClass;
	readonly conflict: ConflictRule;
	readonly phase: FacetPhase;
	readonly defaultValue: T;
};

/** Supported schema majors for on-disk facet envelopes. */
export const DRIVE_FACET_SCHEMA_VERSION = 1 as const;
export type DriveFacetSchemaVersion = typeof DRIVE_FACET_SCHEMA_VERSION;

export class UnknownFacetSchemaVersionError extends Error {
	readonly code = "unknown_facet_schema_version" as const;

	constructor(readonly found: unknown) {
		super(
			`Unknown Drive facet schemaVersion major: ${String(found)}. Supported: ${DRIVE_FACET_SCHEMA_VERSION}`,
		);
		this.name = "UnknownFacetSchemaVersionError";
	}
}
