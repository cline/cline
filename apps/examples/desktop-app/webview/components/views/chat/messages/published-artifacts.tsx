"use client";

import { SUPPORTED_IMAGE_MEDIA_TYPES } from "@cline/shared/browser";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useArtifactResource } from "@/hooks/use-artifact-resource";
import { imageAttachmentMediaType } from "@/lib/image-attachments";
import { ArtifactImage } from "./artifact-image";
import { normalizeDisplayValue } from "./tool-summaries";

const PublicationSchema = z.object({
	files: z
		.array(
			z.union([
				z.object({
					path: z.string(),
					error: z.object({ code: z.string(), message: z.string() }),
				}),
				z.object({
					path: z.string(),
					artifactId: z.string().min(1),
					error: z.never().optional(),
				}),
			]),
		)
		.nonempty(),
});

export function parsePublishedArtifacts(value: unknown) {
	const parsed = PublicationSchema.safeParse(normalizeDisplayValue(value));
	return parsed.success ? parsed.data.files : undefined;
}

export function PublishedArtifacts({
	files,
	sessionId,
}: {
	files: z.infer<typeof PublicationSchema>["files"];
	sessionId: string;
}) {
	return (
		<ul className="space-y-2 py-1 text-sm">
			{files.map((file, index) => {
				const name = file.path.split(/[\\/]/).pop() || file.path;
				const mediaType = imageAttachmentMediaType({ name, type: "" });
				return (
					<li
						key={`${index}:${file.path}`}
						className="flex flex-wrap items-center gap-2"
					>
						<span className="break-all">{name}</span>
						{file.error ? (
							<span className="text-destructive">{file.error.message}</span>
						) : (
							<>
								<DownloadArtifact
									sessionId={sessionId}
									artifactId={file.artifactId}
								/>
								{mediaType &&
									SUPPORTED_IMAGE_MEDIA_TYPES.some(
										(type) => type === mediaType,
									) && (
										<ArtifactImage
											sessionId={sessionId}
											media={{
												id: file.artifactId,
												name,
												modality: "image",
												mediaType,
												source: {
													type: "artifact",
													artifactId: file.artifactId,
												},
											}}
											classNames={{
												image:
													"max-h-96 max-w-full rounded-lg border border-border object-contain",
											}}
										/>
									)}
							</>
						)}
					</li>
				);
			})}
		</ul>
	);
}

function DownloadArtifact({
	sessionId,
	artifactId,
}: {
	sessionId: string;
	artifactId: string;
}) {
	const { accountReady, state, open } = useArtifactResource({
		sessionId,
		reference: { type: "artifact", artifactId },
	});
	const busy = state.status === "loading";
	const failed = state.status === "error";
	return (
		<>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={!accountReady || busy}
				onClick={() => void open()}
			>
				{busy ? "Preparing…" : failed ? "Retry download" : "Download"}
			</Button>
			{failed && (
				<output className="text-destructive">
					Could not download this file.
				</output>
			)}
		</>
	);
}
