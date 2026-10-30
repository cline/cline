"use client";

import { SUPPORTED_IMAGE_MEDIA_TYPES } from "@cline/shared/browser";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
	CarouselNext,
	CarouselPrevious,
} from "@cline/ui";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useArtifactResource } from "@/hooks/use-artifact-resource";
import { imageAttachmentMediaType } from "@/lib/image-attachments";
import { ArtifactImage } from "./artifact-image";
import type { PublishedFile } from "./tool-summaries";

export function PublishedArtifacts({
	files,
	sessionId,
}: {
	files: PublishedFile[];
	sessionId: string;
}) {
	const images: ReactNode[] = [];
	const otherFiles: ReactNode[] = [];
	for (const [index, file] of files.entries()) {
		const name = file.path.split(/[\\/]/).pop() || file.path;
		const mediaType = imageAttachmentMediaType({ name, type: "" });
		const details = (
			<div className="flex flex-wrap items-center gap-2">
				<span className="break-all">{name}</span>
				{file.error ? (
					<span className="text-destructive">{file.error.message}</span>
				) : (
					<DownloadArtifact
						sessionId={sessionId}
						artifactId={file.artifactId}
						downloadFilename={name}
					/>
				)}
			</div>
		);
		const key = `${index}:${file.path}`;
		if (
			!file.error &&
			mediaType &&
			SUPPORTED_IMAGE_MEDIA_TYPES.some((type) => type === mediaType)
		) {
			images.push(
				<CarouselItem key={key} aria-label={name} className="space-y-2">
					{details}
					<ArtifactImage
						sessionId={sessionId}
						media={{
							id: file.artifactId,
							name,
							modality: "image",
							mediaType,
							source: { type: "artifact", artifactId: file.artifactId },
						}}
						className="flex min-h-48 items-center justify-center rounded-lg border border-border bg-muted/30"
						classNames={{ image: "max-h-96 max-w-full object-contain" }}
					/>
				</CarouselItem>,
			);
		} else {
			otherFiles.push(<li key={key}>{details}</li>);
		}
	}
	return (
		<div className="min-w-0 space-y-2 py-1 text-sm">
			{images.length > 0 && (
				<Carousel aria-label="Published images" opts={{ loop: true }}>
					<CarouselContent>{images}</CarouselContent>
					{images.length > 1 && (
						<div className="mt-2 flex items-center justify-end gap-2">
							<span className="mr-auto text-muted-foreground">
								{images.length} images
							</span>
							<CarouselPrevious className="rounded-md border border-border p-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" />
							<CarouselNext className="rounded-md border border-border p-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" />
						</div>
					)}
				</Carousel>
			)}
			{otherFiles.length > 0 && <ul className="space-y-2">{otherFiles}</ul>}
		</div>
	);
}

function DownloadArtifact({
	sessionId,
	artifactId,
	downloadFilename,
}: {
	sessionId: string;
	artifactId: string;
	downloadFilename: string;
}) {
	const { accountReady, state, open } = useArtifactResource({
		sessionId,
		reference: { type: "artifact", artifactId },
		downloadFilename,
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
