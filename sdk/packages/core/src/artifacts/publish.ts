import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createTool } from "@cline/shared";

export type ArtifactPublicationResult =
	| { path: string; artifactId: string }
	| {
			path: string;
			artifactId?: string;
			error: { code: string; message: string };
	  };
export type ArtifactPublicationFile = {
	path: string;
	artifactId: string;
	size: number;
	modifiedAt: number;
};
// Return one result per file in input order, including per-file failures.
export type ArtifactPublisher = (
	files: readonly ArtifactPublicationFile[],
	options: { signal?: AbortSignal },
) => Promise<ArtifactPublicationResult[]>;

export class ArtifactPublicationError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ArtifactPublicationError(
			"INVALID_INPUT",
			"Expected a JSON object",
		);
	return Object.fromEntries(Object.entries(value));
}

export function publicationFailure(
	path: string,
	error: unknown,
	artifactId?: string,
	signal?: AbortSignal,
): ArtifactPublicationResult {
	return {
		path,
		artifactId,
		error: signal?.aborted
			? { code: "CANCELLED", message: "Publication cancelled" }
			: error instanceof ArtifactPublicationError
				? { code: error.code, message: error.message }
				: {
						code: "FILE_READ_FAILED",
						message: "Could not read the local file",
					},
	};
}

async function localFile(value: unknown): Promise<ArtifactPublicationFile> {
	const entry = object(value);
	if (typeof entry.path !== "string" || !isAbsolute(entry.path))
		throw new ArtifactPublicationError(
			"INVALID_INPUT",
			"Each entry requires an absolute file path",
		);
	const artifactId = entry.artifactId ?? randomUUID();
	if (typeof artifactId !== "string" || artifactId.length === 0)
		throw new ArtifactPublicationError(
			"INVALID_INPUT",
			"artifactId must be a non-empty string",
		);
	const path = entry.path;
	let info: Stats;
	try {
		info = await stat(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			throw new ArtifactPublicationError(
				"FILE_NOT_FOUND",
				"Local file does not exist",
			);
		throw error;
	}
	if (!info.isFile())
		throw new ArtifactPublicationError(
			"INVALID_INPUT",
			"Path must refer to a regular file",
		);
	return {
		path,
		artifactId,
		size: info.size,
		modifiedAt: info.mtimeMs,
	};
}

export function createPublishArtifactsTool({
	publish,
}: {
	publish: ArtifactPublisher;
}) {
	return createTool<unknown, { files: ArtifactPublicationResult[] }>({
		name: "publish_artifacts",
		resultPolicy: "cache-oversized",
		description:
			"Publish selected files to make them available outside the current workspace. " +
			"Requires absolute file paths. Returns artifact IDs for successful publications. " +
			"Omit artifactId for new files; preserve a returned ID when retrying a failed publication. Reports each file separately.",
		inputSchema: {
			type: "object",
			properties: {
				files: {
					type: "array",
					minItems: 1,
					maxItems: 20,
					items: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "Absolute path to a local file",
								minLength: 1,
							},
							artifactId: { type: "string", minLength: 1 },
						},
						required: ["path"],
						additionalProperties: false,
					},
				},
			},
			required: ["files"],
			additionalProperties: false,
		},
		async execute(input, context) {
			const { files: entries } = object(input);
			if (
				!Array.isArray(entries) ||
				entries.length === 0 ||
				entries.length > 20
			)
				throw new ArtifactPublicationError(
					"INVALID_INPUT",
					"Select between 1 and 20 files",
				);
			const results: ArtifactPublicationResult[] = [];
			const pending: { index: number; file: ArtifactPublicationFile }[] = [];
			for (const [index, entry] of entries.entries()) {
				const path =
					entry &&
					typeof entry === "object" &&
					"path" in entry &&
					typeof entry.path === "string"
						? entry.path
						: "";
				try {
					context.signal?.throwIfAborted();
					pending.push({ index, file: await localFile(entry) });
				} catch (error) {
					results[index] = publicationFailure(
						path,
						error,
						undefined,
						context.signal,
					);
				}
			}
			if (pending.length) {
				try {
					const published = await publish(
						pending.map(({ file }) => file),
						{ signal: context.signal },
					);
					pending.forEach(({ index }, position) => {
						results[index] = published[position];
					});
				} catch {
					for (const { index, file } of pending)
						results[index] = publicationFailure(
							file.path,
							new ArtifactPublicationError(
								"PUBLICATION_FAILED",
								"Could not publish files",
							),
							file.artifactId,
							context.signal,
						);
				}
			}
			return { files: results };
		},
	});
}
