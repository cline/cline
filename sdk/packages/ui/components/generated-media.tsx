"use client";

import {
	DEFAULT_MAX_TOTAL_MEDIA_BYTES,
	type GeneratedMedia,
	type GeneratedMediaModality,
	isCanonicalBase64,
	SUPPORTED_IMAGE_MEDIA_TYPES,
} from "@cline/shared/browser";
import { useEffect, useState } from "react";

export interface GeneratedMediaClassNames
	extends Partial<Record<GeneratedMediaModality, string>> {
	unavailable?: string;
}

export interface GeneratedMediaContentProps {
	media: GeneratedMedia;
	className?: string;
	classNames?: GeneratedMediaClassNames;
}

function decodeBase64(data: string): ArrayBuffer | undefined {
	if (data.length > DEFAULT_MAX_TOTAL_MEDIA_BYTES || !isCanonicalBase64(data)) {
		return undefined;
	}
	try {
		const binary = atob(data);
		const buffer = new ArrayBuffer(binary.length);
		const bytes = new Uint8Array(buffer);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return buffer;
	} catch {
		return undefined;
	}
}

const MEDIA_TYPE_PATTERN =
	/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

function renderableMediaType(media: GeneratedMedia): string | undefined {
	const mediaType = media.mediaType.trim().toLowerCase();
	if (!MEDIA_TYPE_PATTERN.test(mediaType)) return undefined;
	switch (media.modality) {
		case "image":
			return (SUPPORTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(
				mediaType,
			)
				? mediaType
				: undefined;
		case "audio":
			return mediaType.startsWith("audio/") ? mediaType : undefined;
		case "video":
			return mediaType.startsWith("video/") ? mediaType : undefined;
		case "file":
			// Files are downloads, never active browser content.
			return "application/octet-stream";
	}
}

/**
 * Materialize provider bytes behind a browser-owned URL.
 *
 * Never bind a provider-supplied URL or data URL directly to a DOM navigation
 * sink. Remote and artifact sources require a client-owned resolver with an
 * explicit trust policy; this shared renderer only displays validated inline
 * bytes and revokes the temporary URL when the content changes.
 */
function useInlineMediaUrl(media: GeneratedMedia): string | undefined {
	const inlineData =
		media.source.type === "base64" ? media.source.data : undefined;
	const [source, setSource] = useState<string>();
	const blobMediaType = renderableMediaType(media);

	useEffect(() => {
		setSource(undefined);
		if (inlineData === undefined || blobMediaType === undefined) return;

		const bytes = decodeBase64(inlineData);
		if (!bytes || typeof URL.createObjectURL !== "function") return;

		let objectUrl: string;
		try {
			objectUrl = URL.createObjectURL(
				new Blob([bytes], { type: blobMediaType }),
			);
		} catch {
			return;
		}
		setSource(objectUrl);
		return () => URL.revokeObjectURL?.(objectUrl);
	}, [blobMediaType, inlineData]);

	return source;
}

function unavailableMessage(media: GeneratedMedia): string {
	if (media.source.type === "artifact") {
		return `Generated ${media.modality} is stored as an artifact (${media.source.artifactId}).`;
	}
	if (media.source.type === "url") {
		return `Generated ${media.modality} requires a trusted remote-media resolver.`;
	}
	return `Generated ${media.modality} could not be rendered.`;
}

/** Render canonical generated media with a safe fallback for artifact refs. */
export function GeneratedMediaContent({
	media,
	className,
	classNames,
}: GeneratedMediaContentProps) {
	const source = useInlineMediaUrl(media);
	const browserOwnedSource = source?.startsWith("blob:") ? source : undefined;
	if (!browserOwnedSource) {
		return (
			<div
				className={classNames?.unavailable ?? className}
				data-media-id={media.id}
				data-testid="generated-media-unavailable"
			>
				{unavailableMessage(media)}
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
					src={browserOwnedSource}
				/>
			);
		case "audio":
			return (
				// biome-ignore lint/a11y/useMediaCaption: Model-generated audio does not include a caption track.
				<audio
					className={modalityClassName}
					controls
					data-media-id={media.id}
					src={browserOwnedSource}
				/>
			);
		case "video":
			return (
				// biome-ignore lint/a11y/useMediaCaption: Model-generated video does not include a caption track.
				<video
					className={modalityClassName}
					controls
					data-media-id={media.id}
					src={browserOwnedSource}
				/>
			);
		case "file":
			return (
				<a
					className={modalityClassName}
					data-media-id={media.id}
					download={media.name ?? true}
					href={browserOwnedSource}
				>
					{media.name ?? `Generated file (${media.mediaType})`}
				</a>
			);
	}
	return null;
}
