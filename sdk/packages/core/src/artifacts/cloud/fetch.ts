import { z } from "zod";
import type { ConnectorsRequest } from "../../extensions/composio/composio-meta-tools";
import {
	ArtifactDownloadSchema,
	artifactDownloadPath,
	type CloudArtifactDownload,
} from "./download-url";

const EXPIRY_MARGIN_MS = 30_000;
const MAX_CACHED_URLS = 128;

const DownloadResponseSchema = z.object({
	success: z.literal(true),
	data: ArtifactDownloadSchema,
});

export function createArtifactFetcher({
	request,
	cloudSessionId,
}: {
	request: ConnectorsRequest;
	cloudSessionId: string;
}) {
	const urls = new Map<string, CloudArtifactDownload>();
	return async function fetchArtifact({
		artifactId,
		signal,
	}: {
		artifactId: string;
		signal?: AbortSignal;
	}): Promise<Response> {
		const path = artifactDownloadPath(cloudSessionId, artifactId);
		for (let attempt = 0; ; attempt++) {
			signal?.throwIfAborted();
			let download = urls.get(artifactId);
			if (
				!download ||
				Date.parse(download.expiresAt) <= Date.now() + EXPIRY_MARGIN_MS
			) {
				urls.delete(artifactId);
				const authorization = await request(path, {
					method: "GET",
					redirect: "error",
					cache: "no-store",
					signal: AbortSignal.any([
						...(signal ? [signal] : []),
						AbortSignal.timeout(15_000),
					]),
				});
				if (!authorization.ok) {
					await authorization.body?.cancel().catch(() => {});
					throw new Error(
						`Artifact service returned HTTP ${authorization.status}`,
					);
				}
				const parsed = DownloadResponseSchema.safeParse(
					await authorization.json(),
				);
				if (!parsed.success)
					throw new Error("Artifact service returned an invalid download URL");
				download = parsed.data.data;
			}
			signal?.throwIfAborted();
			const response = await fetch(download.url, {
				method: "GET",
				credentials: "omit",
				redirect: "error",
				cache: "no-store",
				signal,
			});
			if (response.ok) {
				if (Date.parse(download.expiresAt) > Date.now() + EXPIRY_MARGIN_MS) {
					urls.delete(artifactId);
					if (urls.size >= MAX_CACHED_URLS) {
						const oldest = urls.keys().next();
						if (!oldest.done) urls.delete(oldest.value);
					}
					urls.set(artifactId, download);
				}
				return response;
			}
			urls.delete(artifactId);
			await response.body?.cancel().catch(() => {});
			// A signed URL may expire between authorization and the storage request.
			if (response.status === 403 && attempt === 0) continue;
			throw new Error(`Artifact download returned HTTP ${response.status}`);
		}
	};
}
