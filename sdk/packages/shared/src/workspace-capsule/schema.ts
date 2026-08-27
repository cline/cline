import { z } from "zod";

/**
 * Wire-format version for workspace capsules.
 *
 * A version bump is required for any incompatible manifest change. Readers
 * must reject versions they do not understand instead of guessing.
 */
export const WORKSPACE_CAPSULE_MANIFEST_VERSION = 1 as const;
export const WORKSPACE_CAPSULE_MANIFEST_ARCHIVE_PATH =
	".cline-capsule-manifest.json" as const;
export const WORKSPACE_CAPSULE_MEDIA_TYPE =
	"application/vnd.cline.workspace-capsule.v1+tar+gzip" as const;
export const WORKSPACE_CAPSULE_ARCHIVE_FORMAT = "tar+gzip" as const;
export const WORKSPACE_CAPSULE_MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
export const WORKSPACE_CAPSULE_MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
export const WORKSPACE_CAPSULE_MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;

const CapsulePathSchema = z
	.string()
	.min(1)
	.refine(
		(value) =>
			!value.startsWith("/") &&
			!value.includes("\\") &&
			![...value].some((character) => {
				const code = character.charCodeAt(0);
				return code <= 0x1f || code === 0x7f;
			}) &&
			value
				.split("/")
				.every((part) => part.length > 0 && part !== "." && part !== "..") &&
			value !== WORKSPACE_CAPSULE_MANIFEST_ARCHIVE_PATH &&
			!value.split("/").some((part) => {
				const normalized = part.toLowerCase();
				return (
					normalized === ".git" ||
					normalized === ".ssh" ||
					normalized === ".env" ||
					(normalized.startsWith(".env.") && normalized !== ".env.example")
				);
			}),
		"Capsule paths must be normalized, relative POSIX paths without traversal",
	);

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const WorkspaceCapsuleRootSchema = z
	.object({
		id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
	})
	.strict();

const WorkspaceCapsuleEntryCommonSchema = z.object({
	path: CapsulePathSchema,
	sourceRootId: z.string().min(1),
	purpose: z.enum(["workspace", "artifact"]),
	mode: z.number().int().min(0).max(0o777),
});

export const WorkspaceCapsuleFileEntrySchema =
	WorkspaceCapsuleEntryCommonSchema.extend({
		kind: z.literal("file"),
		size: z.number().int().nonnegative(),
		sha256: Sha256Schema,
	}).strict();

export const WorkspaceCapsuleDirectoryEntrySchema =
	WorkspaceCapsuleEntryCommonSchema.extend({
		kind: z.literal("directory"),
		size: z.literal(0),
	}).strict();

export const WorkspaceCapsuleEntrySchema = z.discriminatedUnion("kind", [
	WorkspaceCapsuleFileEntrySchema,
	WorkspaceCapsuleDirectoryEntrySchema,
]);

/** Git is optional metadata, never an authority or transport prerequisite. */
export const WorkspaceCapsuleGitMetadataSchema = z
	.object({
		baseCommit: z.string().min(1).optional(),
		headCommit: z.string().min(1).optional(),
		branch: z.string().min(1).optional(),
		remoteUrl: z.string().min(1).optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, {
		message: "Git metadata must contain at least one field",
	});

/** Optional linkage to the existing Cline Teams task/run model. */
export const WorkspaceCapsuleTeamContextSchema = z
	.object({
		teamId: z.string().min(1),
		agentId: z.string().min(1),
		taskId: z.string().min(1).optional(),
		runId: z.string().min(1).optional(),
	})
	.strict();

export const WorkspaceCapsuleManifestSchema = z
	.object({
		version: z.literal(WORKSPACE_CAPSULE_MANIFEST_VERSION),
		createdAt: z.string().datetime(),
		roots: z.array(WorkspaceCapsuleRootSchema).min(1),
		entries: z.array(WorkspaceCapsuleEntrySchema).max(50_000),
		totalBytes: z
			.number()
			.int()
			.nonnegative()
			.max(WORKSPACE_CAPSULE_MAX_UNPACKED_BYTES),
		git: WorkspaceCapsuleGitMetadataSchema.optional(),
		team: WorkspaceCapsuleTeamContextSchema.optional(),
	})
	.strict()
	.superRefine((manifest, context) => {
		const rootIds = new Set<string>();
		for (const [index, root] of manifest.roots.entries()) {
			if (rootIds.has(root.id)) {
				context.addIssue({
					code: "custom",
					path: ["roots", index, "id"],
					message: `Duplicate capsule root id: ${root.id}`,
				});
			}
			rootIds.add(root.id);
		}

		const entryPaths = new Set<string>();
		let computedTotalBytes = 0;
		for (const [index, entry] of manifest.entries.entries()) {
			if (!rootIds.has(entry.sourceRootId)) {
				context.addIssue({
					code: "custom",
					path: ["entries", index, "sourceRootId"],
					message: `Unknown capsule root id: ${entry.sourceRootId}`,
				});
			}
			if (entryPaths.has(entry.path)) {
				context.addIssue({
					code: "custom",
					path: ["entries", index, "path"],
					message: `Duplicate capsule entry path: ${entry.path}`,
				});
			}
			entryPaths.add(entry.path);
			computedTotalBytes += entry.size;
		}

		if (computedTotalBytes !== manifest.totalBytes) {
			context.addIssue({
				code: "custom",
				path: ["totalBytes"],
				message: `Expected totalBytes=${computedTotalBytes}`,
			});
		}
	});

export const WorkspaceCapsuleArchiveMetadataSchema = z
	.object({
		version: z.literal(1),
		manifestVersion: z.literal(WORKSPACE_CAPSULE_MANIFEST_VERSION),
		mediaType: z.literal(WORKSPACE_CAPSULE_MEDIA_TYPE),
		format: z.literal(WORKSPACE_CAPSULE_ARCHIVE_FORMAT),
		sha256: Sha256Schema,
		manifestSha256: Sha256Schema,
		archiveSizeBytes: z
			.number()
			.int()
			.positive()
			.max(WORKSPACE_CAPSULE_MAX_ARCHIVE_BYTES),
		unpackedSizeBytes: z
			.number()
			.int()
			.nonnegative()
			.max(WORKSPACE_CAPSULE_MAX_UNPACKED_BYTES),
	})
	.strict();

export const WorkspaceCapsuleArchiveDescriptorSchema =
	WorkspaceCapsuleArchiveMetadataSchema.extend({
		sourceUrl: z
			.string()
			.url()
			.refine((value) => {
				const url = new URL(value);
				return (
					url.protocol === "https:" &&
					url.hostname.length > 0 &&
					!url.username &&
					!url.password &&
					!url.hash
				);
			}, "Capsule sourceUrl must be HTTPS without userinfo or a fragment"),
	}).strict();

export type WorkspaceCapsuleRoot = z.infer<typeof WorkspaceCapsuleRootSchema>;
export type WorkspaceCapsuleEntry = z.infer<typeof WorkspaceCapsuleEntrySchema>;
export type WorkspaceCapsuleFileEntry = z.infer<
	typeof WorkspaceCapsuleFileEntrySchema
>;
export type WorkspaceCapsuleDirectoryEntry = z.infer<
	typeof WorkspaceCapsuleDirectoryEntrySchema
>;
export type WorkspaceCapsuleGitMetadata = z.infer<
	typeof WorkspaceCapsuleGitMetadataSchema
>;
export type WorkspaceCapsuleTeamContext = z.infer<
	typeof WorkspaceCapsuleTeamContextSchema
>;
export type WorkspaceCapsuleManifest = z.infer<
	typeof WorkspaceCapsuleManifestSchema
>;
export type WorkspaceCapsuleArchiveMetadata = z.infer<
	typeof WorkspaceCapsuleArchiveMetadataSchema
>;
export type WorkspaceCapsuleArchiveDescriptor = z.infer<
	typeof WorkspaceCapsuleArchiveDescriptorSchema
>;
