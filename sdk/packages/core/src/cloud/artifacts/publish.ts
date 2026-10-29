import { randomUUID } from "node:crypto";
import { openAsBlob, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createTool } from "@cline/shared";
import type { ConnectorsRequest } from "../../extensions/composio/composio-meta-tools";

type Result =
	| { path: string; artifactId: string }
	| {
			path: string;
			artifactId?: string;
			error: { code: string; message: string };
	  };
type LocalFile = {
	path: string;
	index: number;
	artifactId: string;
	size: number;
	modifiedAt: number;
};
type UploadPolicy = {
	url: string;
	fields: Record<string, string>;
	keyPrefix: string;
	maxBytes: number;
	expiresAt: number;
};

class PublishError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

function object(
	value: unknown,
	code = "INVALID_RESPONSE",
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new PublishError(code, "Expected a JSON object");
	return Object.fromEntries(Object.entries(value));
}

function failure(
	path: string,
	error: unknown,
	artifactId?: string,
	signal?: AbortSignal,
): Result {
	return {
		path,
		artifactId,
		error: signal?.aborted
			? { code: "CANCELLED", message: "Publication cancelled" }
			: error instanceof PublishError
				? { code: error.code, message: error.message }
				: {
						code: "FILE_READ_FAILED",
						message: "Could not read the local file",
					},
	};
}

async function localFile(value: unknown, index: number): Promise<LocalFile> {
	const entry = object(value, "INVALID_INPUT");
	if (typeof entry.path !== "string" || !isAbsolute(entry.path))
		throw new PublishError(
			"INVALID_INPUT",
			"Each entry requires an absolute file path",
		);
	const artifactId = entry.artifactId ?? randomUUID();
	if (typeof artifactId !== "string" || artifactId.length === 0)
		throw new PublishError(
			"INVALID_INPUT",
			"artifactId must be a non-empty string",
		);
	const path = entry.path;
	let info: Stats;
	try {
		info = await stat(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			throw new PublishError("FILE_NOT_FOUND", "Local file does not exist");
		throw error;
	}
	if (!info.isFile())
		throw new PublishError(
			"INVALID_INPUT",
			"Path must refer to a regular file",
		);
	if (info.size === 0)
		throw new PublishError(
			"EMPTY_FILE",
			"The upload policy does not allow empty files",
		);
	return {
		path,
		index,
		artifactId,
		size: info.size,
		modifiedAt: info.mtimeMs,
	};
}

async function checkUnchanged(file: LocalFile) {
	const current = await stat(file.path);
	if (current.size !== file.size || current.mtimeMs !== file.modifiedAt)
		throw new PublishError(
			"FILE_CHANGED",
			"Local file changed after it was selected",
		);
}

function parsePolicy(value: unknown): UploadPolicy {
	const policy = object(value);
	if (
		typeof policy.url !== "string" ||
		typeof policy.keyPrefix !== "string" ||
		!policy.keyPrefix.endsWith("/") ||
		typeof policy.maxBytes !== "number" ||
		!Number.isSafeInteger(policy.maxBytes) ||
		policy.maxBytes < 1 ||
		typeof policy.expiresAt !== "string" ||
		!Number.isFinite(Date.parse(policy.expiresAt))
	)
		throw new PublishError("INVALID_RESPONSE", "Invalid upload policy");
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(object(policy.fields))) {
		if (typeof value !== "string" || /^(key|file)$/i.test(key))
			throw new PublishError("INVALID_RESPONSE", "Invalid upload fields");
		fields[key] = value;
	}
	return {
		url: policy.url,
		fields,
		keyPrefix: policy.keyPrefix,
		maxBytes: policy.maxBytes,
		expiresAt: Date.parse(policy.expiresAt),
	};
}

async function publish(
	files: LocalFile[],
	results: Result[],
	options: PublicationOptions,
	signal?: AbortSignal,
) {
	const { request, cloudSessionId } = options;
	async function sign(): Promise<UploadPolicy> {
		for (let attempt = 0; attempt < 3; attempt++) {
			signal?.throwIfAborted();
			if (attempt) await setTimeout(250 * attempt, undefined, { signal });
			let response: Response;
			try {
				response = await request(
					`/api/v1/session/${encodeURIComponent(cloudSessionId)}/artifacts/upload-policy`,
					{
						method: "POST",
						redirect: "error",
						signal: AbortSignal.any([
							...(signal ? [signal] : []),
							AbortSignal.timeout(120_000),
						]),
					},
				);
			} catch {
				signal?.throwIfAborted();
				continue;
			}
			if (response.status === 429 || response.status >= 500) {
				await response.body?.cancel().catch(() => {});
				continue;
			}
			if (!response.ok) {
				await response.body?.cancel().catch(() => {});
				throw new PublishError(
					"CORE_REJECTED",
					`Artifact service returned HTTP ${response.status}`,
				);
			}
			let envelope: Record<string, unknown>;
			try {
				envelope = object(await response.json());
			} catch {
				signal?.throwIfAborted();
				throw new PublishError(
					"INVALID_RESPONSE",
					"Artifact service returned invalid JSON",
				);
			}
			if (envelope.success !== true)
				throw new PublishError(
					"INVALID_RESPONSE",
					"Artifact service returned an unsuccessful response",
				);
			return parsePolicy(envelope.data);
		}
		throw new PublishError(
			"CORE_UNAVAILABLE",
			"Could not obtain an upload policy after 3 attempts",
		);
	}

	let policy: UploadPolicy;
	try {
		policy = await sign();
	} catch (error) {
		for (const file of files)
			results[file.index] = failure(file.path, error, file.artifactId, signal);
		return;
	}
	for (const file of files) {
		try {
			for (let attempt = 0; attempt < 3; attempt++) {
				signal?.throwIfAborted();
				if (attempt) await setTimeout(250 * attempt, undefined, { signal });
				if (Date.now() >= policy.expiresAt) policy = await sign();
				if (file.size > policy.maxBytes)
					throw new PublishError(
						"FILE_TOO_LARGE",
						`File exceeds the upload policy limit of ${policy.maxBytes} bytes`,
					);
				await checkUnchanged(file);
				const form = new FormData();
				for (const [name, value] of Object.entries(policy.fields))
					form.append(name, value);
				form.append("key", policy.keyPrefix + file.artifactId);
				// GCS requires the file to be the final multipart field.
				form.append(
					"file",
					await openAsBlob(file.path, { type: policy.fields["Content-Type"] }),
					basename(file.path),
				);
				let response: Response | undefined;
				try {
					response = await fetch(policy.url, {
						method: "POST",
						body: form,
						redirect: "error",
						signal: AbortSignal.any([
							...(signal ? [signal] : []),
							AbortSignal.timeout(120_000),
						]),
					});
				} catch {
					signal?.throwIfAborted();
					await checkUnchanged(file);
				}
				if (response?.ok) {
					await response.body?.cancel().catch(() => {});
					break;
				}
				let interrupted = false;
				const expired =
					(response?.status === 400 || response?.status === 403) &&
					/expired/i.test(
						await response.text().catch(() => {
							interrupted = true;
							return "";
						}),
					);
				signal?.throwIfAborted();
				const transient =
					interrupted ||
					!response ||
					response.status === 408 ||
					response.status === 429 ||
					response.status >= 500;
				await response?.body?.cancel().catch(() => {});
				if (!expired && !transient)
					throw new PublishError(
						"UPLOAD_REJECTED",
						`Storage rejected upload with HTTP ${response?.status}`,
					);
				if (attempt === 2)
					throw new PublishError(
						"UPLOAD_FAILED",
						"Upload was not confirmed after 3 attempts; retry with the same artifactId",
					);
				if (expired) policy = await sign();
			}
			results[file.index] = {
				path: file.path,
				artifactId: file.artifactId,
			};
		} catch (error) {
			results[file.index] = failure(file.path, error, file.artifactId, signal);
		}
	}
}

interface PublicationOptions {
	request: ConnectorsRequest;
	cloudSessionId: string;
}

export function createPublishArtifactsTool(options: PublicationOptions) {
	return createTool<unknown, { files: Result[] }>({
		name: "publish_artifacts",
		description:
			"Upload selected files to this cloud session so they remain available after the sandbox stops. " +
			"Requires absolute file paths. Returns artifact IDs for successful uploads. " +
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
			const { files: entries } = object(input, "INVALID_INPUT");
			if (
				!Array.isArray(entries) ||
				entries.length === 0 ||
				entries.length > 20
			)
				throw new PublishError(
					"INVALID_INPUT",
					"Select between 1 and 20 files",
				);
			const results: Result[] = [];
			const files: LocalFile[] = [];
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
					files.push(await localFile(entry, index));
				} catch (error) {
					results[index] = failure(path, error, undefined, context.signal);
				}
			}
			if (files.length) await publish(files, results, options, context.signal);
			return { files: results };
		},
	});
}
