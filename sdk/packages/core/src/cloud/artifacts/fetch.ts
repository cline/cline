import { z } from "zod";
import type { ConnectorsRequest } from "../../extensions/composio/composio-meta-tools";

const DownloadResponseSchema = z.object({
	success: z.literal(true),
	data: z.object({
		url: z
			.string()
			.url()
			.pipe(
				z.string().refine((value) => {
					const url = new URL(value);
					return url.protocol === "https:" && !url.username && !url.password;
				}),
			),
	}),
});

export async function fetchArtifact({
	request,
	cloudSessionId,
	artifactId,
	signal,
}: {
	request: ConnectorsRequest;
	cloudSessionId: string;
	artifactId: string;
	signal?: AbortSignal;
}): Promise<Response> {
	const path = `/api/v1/session/${encodeURIComponent(cloudSessionId)}/artifacts/download-url?name=${encodeURIComponent(artifactId)}`;
	for (let attempt = 0; ; attempt++) {
		signal?.throwIfAborted();
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
			await authorization.body?.cancel();
			throw new Error(`Artifact service returned HTTP ${authorization.status}`);
		}
		const parsed = DownloadResponseSchema.safeParse(await authorization.json());
		if (!parsed.success)
			throw new Error("Artifact service returned an invalid download URL");
		signal?.throwIfAborted();
		const response = await fetch(parsed.data.data.url, {
			method: "GET",
			credentials: "omit",
			redirect: "error",
			cache: "no-store",
			signal,
		});
		if (response.ok) return response;
		await response.body?.cancel();
		// A signed URL may expire between authorization and the storage request.
		if (response.status === 403 && attempt === 0) continue;
		throw new Error(`Artifact download returned HTTP ${response.status}`);
	}
}
