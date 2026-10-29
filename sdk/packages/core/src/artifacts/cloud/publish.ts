import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import type { ConnectorsRequest } from "../../extensions/composio/composio-meta-tools";
import {
	ArtifactPublicationError,
	type ArtifactPublicationFile,
	type ArtifactPublicationResult,
	type ArtifactPublisher,
	publicationFailure,
} from "../publish";

const UploadPolicySchema = z.object({
	url: z.string(),
	fields: z.record(
		z.string().refine((key) => !/^(key|file)$/i.test(key)),
		z.string(),
	),
	keyPrefix: z.string().endsWith("/"),
	maxBytes: z.number().int().positive(),
	expiresAt: z
		.string()
		.refine((value) => Number.isFinite(Date.parse(value)))
		.transform(Date.parse),
});
type UploadPolicy = z.infer<typeof UploadPolicySchema>;
const UploadPolicyResponseSchema = z.object({
	success: z.literal(true),
	data: UploadPolicySchema,
});

async function checkUnchanged(file: ArtifactPublicationFile) {
	const current = await stat(file.path);
	if (current.size !== file.size || current.mtimeMs !== file.modifiedAt)
		throw new ArtifactPublicationError(
			"FILE_CHANGED",
			"Local file changed after it was selected",
		);
}

export function createArtifactPublisher({
	request,
	cloudSessionId,
}: {
	request: ConnectorsRequest;
	cloudSessionId: string;
}): ArtifactPublisher {
	return async (files, { signal }) => {
		const results: ArtifactPublicationResult[] = [];
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
								AbortSignal.timeout(15_000),
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
					throw new ArtifactPublicationError(
						"CORE_REJECTED",
						`Artifact service returned HTTP ${response.status}`,
					);
				}
				let envelope: unknown;
				try {
					envelope = await response.json();
				} catch {
					signal?.throwIfAborted();
					throw new ArtifactPublicationError(
						"INVALID_RESPONSE",
						"Artifact service returned invalid JSON",
					);
				}
				const parsed = UploadPolicyResponseSchema.safeParse(envelope);
				if (!parsed.success)
					throw new ArtifactPublicationError(
						"INVALID_RESPONSE",
						"Invalid upload policy",
					);
				return parsed.data.data;
			}
			throw new ArtifactPublicationError(
				"CORE_UNAVAILABLE",
				"Could not obtain an upload policy after 3 attempts",
			);
		}

		let policy: UploadPolicy;
		try {
			policy = await sign();
		} catch (error) {
			for (const file of files)
				results.push(
					publicationFailure(file.path, error, file.artifactId, signal),
				);
			return results;
		}
		for (const file of files) {
			try {
				if (file.size === 0)
					throw new ArtifactPublicationError(
						"EMPTY_FILE",
						"The upload policy does not allow empty files",
					);
				for (let attempt = 0; attempt < 3; attempt++) {
					signal?.throwIfAborted();
					if (attempt) await setTimeout(250 * attempt, undefined, { signal });
					if (Date.now() >= policy.expiresAt) policy = await sign();
					if (file.size > policy.maxBytes)
						throw new ArtifactPublicationError(
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
						await openAsBlob(file.path, {
							type: policy.fields["Content-Type"],
						}),
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
						throw new ArtifactPublicationError(
							"UPLOAD_REJECTED",
							`Storage rejected upload with HTTP ${response?.status}`,
						);
					if (attempt === 2)
						throw new ArtifactPublicationError(
							"UPLOAD_FAILED",
							"Upload was not confirmed after 3 attempts; retry with the same artifactId",
						);
					if (expired) policy = await sign();
				}
				results.push({ path: file.path, artifactId: file.artifactId });
			} catch (error) {
				results.push(
					publicationFailure(file.path, error, file.artifactId, signal),
				);
			}
		}
		return results;
	};
}
