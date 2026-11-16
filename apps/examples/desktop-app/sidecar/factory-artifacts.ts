import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { resolveTasksDbPath } from "@cline/shared/storage";
import { z } from "zod";

const artifactSchema = z.object({
	path: z.string(),
	mimeType: z.string(),
	thumbnailPath: z.string().optional(),
});
const artifactReplySchema = z.object({
	runs: z
		.array(
			z.object({
				runId: z.string(),
				factory: z
					.object({
						candidate: z
							.object({
								checks: z.array(
									z.object({ artifacts: z.array(artifactSchema) }),
								),
								stages: z
									.array(
										z.object({ artifacts: z.array(artifactSchema).optional() }),
									)
									.optional(),
								verification: z
									.object({ artifacts: z.array(artifactSchema) })
									.optional(),
							})
							.optional(),
					})
					.optional(),
			}),
		)
		.default([]),
});
const MEDIA_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"video/mp4",
	"video/webm",
]);

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 200 * 1024;

async function realPathInsideStorage(path: string): Promise<string> {
	const resolved = await realpath(path);
	const root = await realpath(
		join(dirname(resolveTasksDbPath()), "factory", "factory-artifacts"),
	);
	const child = relative(root, resolved);
	if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
		throw new Error("Evidence must remain inside factory artifact storage.");
	return resolved;
}

/**
 * Finds the recorded artifact for a run (a check, the verification, or a
 * repository stage) and resolves its file inside factory artifact storage.
 * `path` may also be the `thumbnailPath` of a recorded artifact.
 */
export async function resolveFactoryArtifact(
	reply: unknown,
	runId: string,
	path: string,
): Promise<{
	file: string;
	mimeType: string;
	size: number;
	thumbnailFile?: string;
}> {
	const run = artifactReplySchema
		.parse(reply)
		.runs.find((item) => item.runId === runId);
	const candidate = run?.factory?.candidate;
	const recorded = [
		...(candidate?.checks.flatMap((check) => check.artifacts) ?? []),
		...(candidate?.stages?.flatMap((stage) => stage.artifacts ?? []) ?? []),
		...(candidate?.verification?.artifacts ?? []),
	];
	const artifact = recorded.find((item) => item.path === path);
	const owner =
		artifact ?? recorded.find((item) => item.thumbnailPath === path);
	if (
		!owner ||
		!run?.factory ||
		(artifact && !MEDIA_TYPES.has(artifact.mimeType))
	)
		throw new Error(
			"This media file is not recorded evidence for the feature run.",
		);
	const file = await realPathInsideStorage(path);
	const stats = await stat(file);
	if (!stats.isFile())
		throw new Error("Evidence preview supports files up to 50 MB.");
	const thumbnailFile =
		artifact?.thumbnailPath === undefined
			? undefined
			: await realPathInsideStorage(artifact.thumbnailPath).catch(
					() => undefined,
				);
	return {
		file,
		mimeType: artifact ? artifact.mimeType : "image/jpeg",
		size: stats.size,
		thumbnailFile,
	};
}

export async function readFactoryArtifact(
	reply: unknown,
	runId: string,
	path: string,
	variant?: "thumbnail",
): Promise<{ dataUrl: string }> {
	const resolved = await resolveFactoryArtifact(reply, runId, path);
	const thumbnail = variant === "thumbnail";
	const file = thumbnail ? resolved.thumbnailFile : resolved.file;
	if (!file) throw new Error("This evidence has no thumbnail.");
	const limit = thumbnail ? MAX_THUMBNAIL_BYTES : MAX_PREVIEW_BYTES;
	const handle = await open(file, "r");
	try {
		const stats = await handle.stat();
		if (!stats.isFile() || stats.size > limit)
			throw new Error(
				thumbnail
					? "Thumbnails are limited to 200 KB."
					: "Evidence preview supports files up to 50 MB.",
			);
		const bytes = Buffer.alloc(stats.size);
		const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
		return {
			dataUrl: `data:${thumbnail ? "image/jpeg" : resolved.mimeType};base64,${bytes.subarray(0, bytesRead).toString("base64")}`,
		};
	} finally {
		await handle.close();
	}
}
