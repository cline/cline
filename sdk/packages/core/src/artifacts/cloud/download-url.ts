import { z } from "zod";

export const ArtifactDownloadSchema = z.object({
	url: z
		.string()
		.url()
		.pipe(
			z.string().refine((value) => {
				const url = new URL(value);
				return url.protocol === "https:" && !url.username && !url.password;
			}),
		),
	expiresAt: z.string().datetime({ offset: true }),
});

export type CloudArtifactDownload = z.infer<typeof ArtifactDownloadSchema>;

export function artifactDownloadPath(sessionId: string, artifactId: string) {
	return `/api/v1/session/${encodeURIComponent(sessionId)}/artifacts/download-url?name=${encodeURIComponent(artifactId)}`;
}
