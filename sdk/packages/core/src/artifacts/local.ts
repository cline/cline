import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, openAsBlob } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ArtifactFetcher } from "./fetch";
import {
	ArtifactPublicationError,
	type ArtifactPublicationResult,
	type ArtifactPublisher,
	checkUnchanged,
	publicationFailure,
} from "./publish";

function artifactPaths(directory: string) {
	if (!isAbsolute(directory))
		throw new Error("Artifact directory must be absolute");
	// Encode exact JS strings, including lone surrogates, without filesystem normalization.
	return (artifactId: string) =>
		join(
			directory,
			createHash("sha256").update(artifactId, "utf16le").digest("hex"),
		);
}

export function createLocalArtifactPublisher({
	directory,
}: {
	directory: string;
}): ArtifactPublisher {
	const pathFor = artifactPaths(directory);
	return async (files, { signal }) => {
		const results: ArtifactPublicationResult[] = [];
		for (const file of files) {
			const target = pathFor(file.artifactId);
			const temporary = `${target}.${randomUUID()}.tmp`;
			try {
				signal?.throwIfAborted();
				await checkUnchanged(file);
				await mkdir(directory, { recursive: true, mode: 0o700 });
				await pipeline(
					(await openAsBlob(file.path)).stream(),
					createWriteStream(temporary, {
						flags: "wx",
						mode: 0o600,
						flush: true,
					}),
					{ signal },
				);
				await checkUnchanged(file);
				signal?.throwIfAborted();
				await rename(temporary, target);
				// Rename commits the publication; cancellation afterward cannot undo it.
				results.push({ path: file.path, artifactId: file.artifactId });
			} catch (error) {
				await rm(temporary, { force: true }).catch(() => {});
				results.push(
					publicationFailure(
						file.path,
						error instanceof ArtifactPublicationError
							? error
							: new ArtifactPublicationError(
									"WRITE_FAILED",
									"Could not store the local artifact",
								),
						file.artifactId,
						signal,
					),
				);
			}
		}
		return results;
	};
}

export function createLocalArtifactFetcher({
	directory,
}: {
	directory: string;
}): ArtifactFetcher {
	const pathFor = artifactPaths(directory);
	return async ({ artifactId, signal }) => {
		signal?.throwIfAborted();
		const handle = await open(pathFor(artifactId), "r");
		try {
			const info = await handle.stat();
			signal?.throwIfAborted();
			const stream = handle.createReadStream({ signal });
			return new Response(
				Readable.toWeb(stream, {
					strategy: new ByteLengthQueuingStrategy({
						highWaterMark: stream.readableHighWaterMark,
					}),
				}),
				{
					headers: {
						"Content-Type": "application/octet-stream",
						"Content-Length": String(info.size),
					},
				},
			);
		} catch (error) {
			await handle.close();
			throw error;
		}
	};
}
