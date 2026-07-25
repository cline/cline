/**
 * Facet value + disk envelope schemas (DRV-PLATFORM-CONFIG).
 */

import { z } from "zod";
import { DriveSubModeSchema } from "../room";
import {
	DRIVE_FACET_SCHEMA_VERSION,
	UnknownFacetSchemaVersionError,
} from "./types";

export const DriveInkTokenSchema = z.enum([
	"foreground",
	"muted",
	"success",
	"warning",
	"info",
]);
export type DriveInkToken = z.infer<typeof DriveInkTokenSchema>;

export const InkRefSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("token"),
			token: DriveInkTokenSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("palette"),
			index: z.union([
				z.literal(0),
				z.literal(1),
				z.literal(2),
				z.literal(3),
				z.literal(4),
				z.literal(5),
				z.literal(6),
				z.literal(7),
			]),
		})
		.strict(),
]);
export type InkRef = z.infer<typeof InkRefSchema>;

/** Appearance overlay — no prompts, tools, provider, or model fields. */
export const AgentAppearanceSchema = z
	.object({
		displayName: z.string().min(1).optional(),
		nameInk: InkRefSchema,
		bodyInk: InkRefSchema,
	})
	.strict();
export type AgentAppearance = z.infer<typeof AgentAppearanceSchema>;

export const DriveDefaultsSubModeSchema = DriveSubModeSchema;
export type DriveDefaultsSubMode = z.infer<typeof DriveDefaultsSubModeSchema>;

/** Forbidden keys on durable Drive facet / profile-shaped values (DEC-agent-SoT). */
export const DRIVE_FACET_FORBIDDEN_PROMPT_KEYS = [
	"systemPrompt",
	"prompt",
	"tools",
	"skills",
	"providerId",
	"modelId",
	"provider",
	"model",
	"maxIterations",
] as const;

const FacetScalarEntrySchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("value"),
			value: z.unknown(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("tombstone"),
		})
		.strict(),
]);

const FacetMapEntrySchema = z
	.object({
		kind: z.literal("map"),
		entries: z.record(z.string(), FacetScalarEntrySchema),
	})
	.strict();

export const FacetDiskEntrySchema = z.union([
	FacetScalarEntrySchema,
	FacetMapEntrySchema,
]);
export type FacetDiskEntry = z.infer<typeof FacetDiskEntrySchema>;

export const DriveFacetDiskFileSchema = z
	.object({
		schemaVersion: z.literal(DRIVE_FACET_SCHEMA_VERSION),
		entries: z.record(z.string(), FacetDiskEntrySchema).default({}),
	})
	.strict();
export type DriveFacetDiskFile = z.infer<typeof DriveFacetDiskFileSchema>;

/** Merged durable view consumed by the pure facet store. */
export type DriveFacetDiskSnapshot = {
	readonly schemaVersion: typeof DRIVE_FACET_SCHEMA_VERSION;
	readonly values: Readonly<Record<string, unknown>>;
	/** Per-entity maps (e.g. agent.appearance by profile id). */
	readonly maps: Readonly<
		Record<string, Readonly<Record<string, unknown>>>
	>;
};

export function parseDriveFacetDiskFile(input: unknown): DriveFacetDiskFile {
	if (
		input !== null &&
		typeof input === "object" &&
		"schemaVersion" in input &&
		(input as { schemaVersion: unknown }).schemaVersion !==
			DRIVE_FACET_SCHEMA_VERSION
	) {
		throw new UnknownFacetSchemaVersionError(
			(input as { schemaVersion: unknown }).schemaVersion,
		);
	}
	return DriveFacetDiskFileSchema.parse(input);
}

/** v1 migration is identity (applied at hub parse boundary). */
export function migrateDriveFacetDiskFile(
	file: DriveFacetDiskFile,
): DriveFacetDiskFile {
	return file;
}
