import { open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { resolveTasksDbPath } from "@cline/shared/storage";
import { z } from "zod";

const artifactSchema = z.object({ path: z.string(), mimeType: z.string() });
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

export async function readFactoryArtifact(
	reply: unknown,
	runId: string,
	path: string,
): Promise<{ dataUrl: string }> {
	const run = artifactReplySchema
		.parse(reply)
		.runs.find((item) => item.runId === runId);
	const candidate = run?.factory?.candidate;
	const artifact = [
		...(candidate?.checks.flatMap((check) => check.artifacts) ?? []),
		...(candidate?.verification?.artifacts ?? []),
	].find((item) => item.path === path);
	if (!artifact || !run?.factory || !MEDIA_TYPES.has(artifact.mimeType))
		throw new Error(
			"This media file is not recorded evidence for the feature run.",
		);
	const resolved = await realpath(path);
	const root = await realpath(
		join(dirname(resolveTasksDbPath()), "factory", "factory-artifacts"),
	);
	const child = relative(root, resolved);
	if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
		throw new Error("Evidence must remain inside factory artifact storage.");
	const file = await open(resolved, "r");
	try {
		const stats = await file.stat();
		if (!stats.isFile() || stats.size > 50 * 1024 * 1024)
			throw new Error("Evidence preview supports files up to 50 MB.");
		const bytes = Buffer.alloc(stats.size);
		const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
		return {
			dataUrl: `data:${artifact.mimeType};base64,${bytes.subarray(0, bytesRead).toString("base64")}`,
		};
	} finally {
		await file.close();
	}
}
