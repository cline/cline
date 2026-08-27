import { describe, expect, it } from "vitest";
import {
	WORKSPACE_CAPSULE_MANIFEST_VERSION,
	WORKSPACE_CAPSULE_MAX_ARCHIVE_BYTES,
	WORKSPACE_CAPSULE_MAX_UNPACKED_BYTES,
	WorkspaceCapsuleArchiveDescriptorSchema,
	WorkspaceCapsuleArchiveMetadataSchema,
	WorkspaceCapsuleManifestSchema,
} from "./schema";

const HASH = "a".repeat(64);

function validManifest() {
	return {
		version: WORKSPACE_CAPSULE_MANIFEST_VERSION,
		createdAt: "2026-08-26T12:00:00.000Z",
		roots: [{ id: "workspace" }],
		entries: [
			{
				kind: "file" as const,
				path: "src/index.ts",
				sourceRootId: "workspace",
				purpose: "workspace" as const,
				mode: 0o644,
				size: 12,
				sha256: HASH,
			},
		],
		totalBytes: 12,
	};
}

describe("WorkspaceCapsuleManifestSchema", () => {
	it("accepts a filesystem-only capsule with no Git or GitHub metadata", () => {
		expect(WorkspaceCapsuleManifestSchema.parse(validManifest())).toEqual(
			validManifest(),
		);
	});

	it("rejects traversal, duplicate destinations, and unknown roots", () => {
		const manifest = validManifest();
		manifest.entries = [
			{ ...manifest.entries[0], path: "../secret" },
			{ ...manifest.entries[0], sourceRootId: "missing" },
		];
		manifest.totalBytes = 24;
		const result = WorkspaceCapsuleManifestSchema.safeParse(manifest);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.map((issue) => issue.message)).toEqual(
				expect.arrayContaining([
					"Capsule paths must be normalized, relative POSIX paths without traversal",
					"Unknown capsule root id: missing",
				]),
			);
		}
	});

	it.each([
		"line\nbreak.txt",
		".cline-capsule-manifest.json",
		"nested/.git/config",
		"nested/.ssh/config",
		"config/.env",
		"config/.env.production",
		"config/.envrc",
		"config/.envrc.local",
	])("rejects protected or non-portable entry path %s", (path) => {
		const manifest = validManifest();
		manifest.entries[0].path = path;
		expect(WorkspaceCapsuleManifestSchema.safeParse(manifest).success).toBe(
			false,
		);
	});

	it("rejects a checked-in .env.example path", () => {
		const manifest = validManifest();
		manifest.entries[0].path = ".env.example";
		expect(WorkspaceCapsuleManifestSchema.safeParse(manifest).success).toBe(
			false,
		);
	});

	it("rejects an incorrect aggregate byte count", () => {
		const manifest = validManifest();
		manifest.totalBytes = 11;
		expect(WorkspaceCapsuleManifestSchema.safeParse(manifest).success).toBe(
			false,
		);
	});

	it("accepts optional team task/run linkage without changing team semantics", () => {
		const manifest = {
			...validManifest(),
			team: {
				teamId: "t_123",
				agentId: "reviewer",
				taskId: "task_7",
				runId: "run_00001",
			},
		};
		expect(WorkspaceCapsuleManifestSchema.parse(manifest).team).toEqual(
			manifest.team,
		);
	});

	it("rejects special mode bits and oversized archive descriptors", () => {
		const manifest = validManifest();
		manifest.entries[0].mode = 0o4755;
		expect(WorkspaceCapsuleManifestSchema.safeParse(manifest).success).toBe(
			false,
		);
		expect(
			WorkspaceCapsuleArchiveMetadataSchema.safeParse({
				version: 1,
				manifestVersion: 1,
				mediaType: "application/vnd.cline.workspace-capsule.v1+tar+gzip",
				format: "tar+gzip",
				sha256: HASH,
				manifestSha256: HASH,
				archiveSizeBytes: WORKSPACE_CAPSULE_MAX_ARCHIVE_BYTES + 1,
				unpackedSizeBytes: 12,
			}).success,
		).toBe(false);
	});

	it("enforces wire entry and unpacked-size limits", () => {
		const oversized = validManifest();
		oversized.totalBytes = WORKSPACE_CAPSULE_MAX_UNPACKED_BYTES + 1;
		expect(WorkspaceCapsuleManifestSchema.safeParse(oversized).success).toBe(
			false,
		);

		const tooManyEntries = validManifest();
		tooManyEntries.entries = Array.from({ length: 50_001 }, (_, index) => ({
			...tooManyEntries.entries[0],
			path: `file-${index}`,
			size: 0,
		}));
		tooManyEntries.totalBytes = 0;
		const result = WorkspaceCapsuleManifestSchema.safeParse(tooManyEntries);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ path: ["entries"], code: "too_big" }),
				]),
			);
		}
	});

	it("requires a positive archive size and a credential-free HTTPS source URL", () => {
		const metadata = {
			version: 1 as const,
			manifestVersion: 1 as const,
			mediaType: "application/vnd.cline.workspace-capsule.v1+tar+gzip" as const,
			format: "tar+gzip" as const,
			sha256: HASH,
			manifestSha256: HASH,
			archiveSizeBytes: 1,
			unpackedSizeBytes: 12,
		};
		expect(
			WorkspaceCapsuleArchiveMetadataSchema.safeParse({
				...metadata,
				archiveSizeBytes: 0,
			}).success,
		).toBe(false);
		expect(
			WorkspaceCapsuleArchiveDescriptorSchema.parse({
				...metadata,
				sourceUrl: "https://objects.example.com/capsule",
			}).sourceUrl,
		).toBe("https://objects.example.com/capsule");
		for (const sourceUrl of [
			"http://objects.example.com/capsule",
			"https://user:password@objects.example.com/capsule",
			"https://objects.example.com/capsule#fragment",
		]) {
			expect(
				WorkspaceCapsuleArchiveDescriptorSchema.safeParse({
					...metadata,
					sourceUrl,
				}).success,
			).toBe(false);
		}
	});
});
