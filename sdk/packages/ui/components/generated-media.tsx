"use client";

import {
	type GeneratedMedia,
	type GeneratedMediaModality,
	generatedMediaSourceUrl,
} from "@cline/shared/browser";

export interface GeneratedMediaClassNames
	extends Partial<Record<GeneratedMediaModality, string>> {
	unavailable?: string;
}

export interface GeneratedMediaContentProps {
	media: GeneratedMedia;
	className?: string;
	classNames?: GeneratedMediaClassNames;
}

/** Render canonical generated media with a safe fallback for artifact refs. */
export function GeneratedMediaContent({
	media,
	className,
	classNames,
}: GeneratedMediaContentProps) {
	const source = generatedMediaSourceUrl(media);
	if (!source) {
		return (
			<div
				className={classNames?.unavailable ?? className}
				data-media-id={media.id}
				data-testid="generated-media-unavailable"
			>
				Generated {media.modality} is stored as an artifact
				{media.source.type === "artifact"
					? ` (${media.source.artifactId})`
					: ""}
				.
			</div>
		);
	}

	const modalityClassName = classNames?.[media.modality] ?? className;
	switch (media.modality) {
		case "image":
			return (
				<img
					alt={media.name ?? "Generated image"}
					className={modalityClassName}
					data-media-id={media.id}
					src={source}
				/>
			);
		case "audio":
			return (
				// biome-ignore lint/a11y/useMediaCaption: Model-generated audio does not include a caption track.
				<audio
					className={modalityClassName}
					controls
					data-media-id={media.id}
					src={source}
				/>
			);
		case "video":
			return (
				// biome-ignore lint/a11y/useMediaCaption: Model-generated video does not include a caption track.
				<video
					className={modalityClassName}
					controls
					data-media-id={media.id}
					src={source}
				/>
			);
		case "file":
			return (
				<a
					className={modalityClassName}
					data-media-id={media.id}
					download={media.name ?? true}
					href={source}
				>
					{media.name ?? `Generated file (${media.mediaType})`}
				</a>
			);
	}
	return null;
}
