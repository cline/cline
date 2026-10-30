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
	const images: {
		key: string;
		name: string;
		caption?: string;
		artifactId: string;
		mediaType: string;
	}[] = [];
	const otherFiles: ReactNode[] = [];
	for (const [index, file] of files.entries()) {
		const name = file.path.split(/[\\/]/).pop() || file.path;
		const mediaType = imageAttachmentMediaType({ name, type: "" });
		const key = `${index}:${file.path}`;
		if (
			!file.error &&
			mediaType &&
			SUPPORTED_IMAGE_MEDIA_TYPES.some((type) => type === mediaType)
		) {
			images.push({
				key,
				name,
				caption: file.caption,
				artifactId: file.artifactId,
				mediaType,
			});
			continue;
		}
		otherFiles.push(
			<li key={key} className="flex flex-wrap items-center gap-2">
				<span className="break-all">{name}</span>
				{file.error ? (
					<span className="text-destructive">{file.error.message}</span>
				) : (
					<DownloadArtifact
						sessionId={sessionId}
						artifactId={file.artifactId}
					/>
				)}
			</li>,
		);
	}
	return (
		<div className="min-w-0 space-y-2 py-1 text-sm">
			{images.length > 0 && (
				<Carousel
					aria-label="Published images"
					opts={{ loop: true }}
					className="@container w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<CarouselContent>
						{images.map((image, index) => (
							<CarouselItem key={image.key} aria-label={image.name}>
								<figure className="flex h-full flex-col">
									{/* 16:10 matches the computer-use display, so screenshots fill the
									    frame; other shapes letterbox instead of being cropped. */}
									<div className="aspect-[16/10] min-h-0 bg-muted/40">
										<ArtifactImage
											sessionId={sessionId}
											media={{
												id: image.artifactId,
												name: image.name,
												modality: "image",
												mediaType: image.mediaType,
												source: {
													type: "artifact",
													artifactId: image.artifactId,
												},
											}}
											className="flex size-full items-center justify-center gap-2 text-muted-foreground"
											classNames={{ image: "size-full object-contain" }}
										/>
									</div>
									<figcaption className="flex flex-1 items-center gap-3 border-t border-border px-3 py-2">
										<div className="min-w-0 flex-1">
											{image.caption && (
												<p className="wrap-break-word text-foreground">
													{image.caption}
												</p>
											)}
											<p className="truncate text-xs text-muted-foreground">
												{images.length > 1 &&
													`${index + 1} of ${images.length} · `}
												{image.name}
											</p>
										</div>
										<DownloadArtifact
											sessionId={sessionId}
											artifactId={image.artifactId}
										/>
									</figcaption>
								</figure>
							</CarouselItem>
						))}
					</CarouselContent>
					{images.length > 1 && (
						<>
							<CarouselPrevious className={`${NAV_BUTTON} left-2`} />
							<CarouselNext className={`${NAV_BUTTON} right-2`} />
						</>
					)}
				</Carousel>
			)}
			{otherFiles.length > 0 && <ul className="space-y-2">{otherFiles}</ul>}
		</div>
	);
}

// Vertically centered on the 16:10 frame: half its height is 31.25% of the width.
const NAV_BUTTON =
	"absolute top-[31.25cqw] flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-background/80 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
