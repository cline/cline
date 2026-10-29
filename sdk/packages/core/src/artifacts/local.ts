import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout } from "node:timers/promises";
import { writeFileAtomic } from "../session/stores/atomic-file";
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

async function commitGeneration(
	path: string,
	generation: string,
	signal?: AbortSignal,
) {
	for (let attempt = 0; ; attempt++) {
		signal?.throwIfAborted();
		try {
			await writeFileAtomic(path, generation);
			return;
		} catch (error) {
			// Windows may briefly hold the reference open while another reader resolves it.
			const code =
				error instanceof Error && "code" in error ? error.code : undefined;
			if (
				attempt === 2 ||
				process.platform !== "win32" ||
				(code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")
			)
				throw error;
			await setTimeout(25 * (attempt + 1), undefined, { signal });
		}
	}
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
			const generation = randomUUID();
			const payload = `${target}.${generation}`;
			try {
				signal?.throwIfAborted();
				await checkUnchanged(file);
				await mkdir(directory, { recursive: true, mode: 0o700 });
				await pipeline(
					createReadStream(file.path),
					createWriteStream(payload, {
						flags: "wx",
						mode: 0o600,
						flush: true,
					}),
					{ signal },
				);
				await checkUnchanged(file);
				await commitGeneration(target, generation, signal);
				// The reference is committed; cancellation afterward cannot remove its payload.
				results.push({ path: file.path, artifactId: file.artifactId });
			} catch (error) {
				await rm(payload, { force: true }).catch(() => {});
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
		const path = pathFor(artifactId);
		const generation = await readFile(path, { encoding: "utf8", signal });
		if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(generation))
			throw new Error("Invalid local artifact generation");
		signal?.throwIfAborted();
		const handle = await open(`${path}.${generation}`, "r");
		try {
			const info = await handle.stat();
			signal?.throwIfAborted();
			const stream = handle.createReadStream({ signal });
			const chunks = stream[Symbol.asyncIterator]();
			return new Response(
				new ReadableStream({
					async pull(controller) {
						const chunk = await chunks.next();
						if (chunk.done) controller.close();
						else controller.enqueue(chunk.value);
					},
					async cancel() {
						stream.destroy();
						await chunks.return?.();
					},
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
