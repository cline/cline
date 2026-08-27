"use client";

import {
	DEFAULT_MAX_TOTAL_MEDIA_BYTES,
	type GeneratedMedia,
	type GeneratedMediaModality,
	isCanonicalBase64,
	SUPPORTED_IMAGE_MEDIA_TYPES,
} from "@cline/shared/browser";
import { clsx } from "clsx";
import { type ReactNode, useEffect, useState } from "react";

export interface GeneratedMediaClassNames
	extends Partial<Record<GeneratedMediaModality, string>> {
	container?: string;
	imageCounter?: string;
	imageFrame?: string;
	imageNavigation?: string;
	imageTrigger?: string;
	unavailable?: string;
}

export type GeneratedMediaImageLayout = "carousel" | "grid";

export interface GeneratedMediaContentProps {
	media: GeneratedMedia | readonly GeneratedMedia[];
	className?: string;
	classNames?: GeneratedMediaClassNames;
	getImageAlt?: (media: GeneratedMedia, index: number) => string;
	getImageExpandLabel?: (media: GeneratedMedia, index: number) => string;
	imageLayout?: GeneratedMediaImageLayout;
	onImageClick?: (media: GeneratedMedia) => void;
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

interface GeneratedMediaItemProps {
	media: GeneratedMedia;
	className?: string;
	classNames?: GeneratedMediaClassNames;
	imageAlt?: string;
	imageExpandLabel?: string;
	onImageClick?: (media: GeneratedMedia) => void;
}

function GeneratedMediaItem({
	media,
	className,
	classNames,
	imageAlt,
	imageExpandLabel,
	onImageClick,
}: GeneratedMediaItemProps) {
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
		case "image": {
			const image = (
				<img
					alt={imageAlt ?? media.name ?? "Generated image"}
					className={modalityClassName}
					data-media-id={media.id}
					src={browserOwnedSource}
				/>
			);
			if (!onImageClick) return image;
			return (
				<button
					aria-label={imageExpandLabel ?? `Expand ${imageAlt ?? "image"}`}
					className={clsx(
						"cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						classNames?.imageTrigger,
					)}
					onClick={() => onImageClick(media)}
					type="button"
				>
					{image}
				</button>
			);
		}
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

function Chevron({ direction }: { direction: "left" | "right" }) {
	return (
		<svg
			aria-hidden="true"
			className="size-4"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
		</svg>
	);
}

interface GeneratedImageCollectionProps
	extends Omit<GeneratedMediaContentProps, "media"> {
	images: readonly GeneratedMedia[];
}

function GeneratedImageCollection({
	images,
	className,
	classNames,
	getImageAlt,
	getImageExpandLabel,
	imageLayout = "carousel",
	onImageClick,
}: GeneratedImageCollectionProps) {
	const [activeIndex, setActiveIndex] = useState(0);
	const lastIndex = images.length - 1;
	const safeIndex = Math.min(activeIndex, lastIndex);

	useEffect(() => {
		setActiveIndex((index) => Math.min(index, lastIndex));
	}, [lastIndex]);

	const renderImage = (image: GeneratedMedia, index: number) => {
		const imageAlt =
			getImageAlt?.(image, index) ??
			image.name ??
			`Generated result ${index + 1}`;
		const imageExpandLabel =
			getImageExpandLabel?.(image, index) ??
			`Expand generated image ${index + 1}`;
		return (
			<div className={clsx("relative", classNames?.imageFrame)} key={image.id}>
				<GeneratedMediaItem
					className={className}
					classNames={classNames}
					imageAlt={imageAlt}
					imageExpandLabel={imageExpandLabel}
					media={image}
					onImageClick={onImageClick}
				/>
			</div>
		);
	};

	if (imageLayout === "grid") {
		return <div className="contents">{images.map(renderImage)}</div>;
	}

	const image = images[safeIndex];
	if (!image) return null;
	return (
		<div className={clsx("relative", classNames?.imageFrame)}>
			<GeneratedMediaItem
				className={className}
				classNames={classNames}
				imageAlt={
					getImageAlt?.(image, safeIndex) ??
					image.name ??
					`Generated result ${safeIndex + 1}`
				}
				imageExpandLabel={
					getImageExpandLabel?.(image, safeIndex) ??
					`Expand generated image ${safeIndex + 1}`
				}
				media={image}
				onImageClick={onImageClick}
			/>
			{images.length > 1 ? (
				<>
					<button
						aria-label="Previous generated image"
						className={clsx(
							"absolute left-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-background disabled:cursor-not-allowed disabled:opacity-35",
							classNames?.imageNavigation,
						)}
						disabled={safeIndex === 0}
						onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
						type="button"
					>
						<Chevron direction="left" />
					</button>
					<button
						aria-label="Next generated image"
						className={clsx(
							"absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-background disabled:cursor-not-allowed disabled:opacity-35",
							classNames?.imageNavigation,
						)}
						disabled={safeIndex === lastIndex}
						onClick={() =>
							setActiveIndex((index) => Math.min(lastIndex, index + 1))
						}
						type="button"
					>
						<Chevron direction="right" />
					</button>
					<div
						className={clsx(
							"absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-background/85 px-2 py-0.5 text-[11px] text-foreground shadow-sm backdrop-blur-sm",
							classNames?.imageCounter,
						)}
					>
						{safeIndex + 1} / {images.length}
					</div>
				</>
			) : null}
		</div>
	);
}

type MediaGroup =
	| { type: "images"; images: GeneratedMedia[] }
	| { type: "item"; media: GeneratedMedia };

function groupMedia(media: readonly GeneratedMedia[]): MediaGroup[] {
	const groups: MediaGroup[] = [];
	for (const item of media) {
		const previous = groups.at(-1);
		if (item.modality === "image") {
			if (previous?.type === "images") previous.images.push(item);
			else groups.push({ type: "images", images: [item] });
		} else {
			groups.push({ type: "item", media: item });
		}
	}
	return groups;
}

/**
 * Safely render one canonical generated-media item or a media collection.
 * Consecutive image items share a carousel (or grid); other modalities retain
 * their original order and render as individual controls.
 */
export function GeneratedMediaContent({
	media,
	className,
	classNames,
	getImageAlt,
	getImageExpandLabel,
	imageLayout = "carousel",
	onImageClick,
}: GeneratedMediaContentProps) {
	if (!Array.isArray(media)) {
		return (
			<GeneratedMediaItem
				className={className}
				classNames={classNames}
				imageAlt={getImageAlt?.(media as GeneratedMedia, 0)}
				imageExpandLabel={getImageExpandLabel?.(media as GeneratedMedia, 0)}
				media={media as GeneratedMedia}
				onImageClick={onImageClick}
			/>
		);
	}

	const groups = groupMedia(media);
	const children = groups.map((group): ReactNode => {
		if (group.type === "images") {
			return (
				<GeneratedImageCollection
					className={className}
					classNames={classNames}
					getImageAlt={getImageAlt}
					getImageExpandLabel={getImageExpandLabel}
					imageLayout={imageLayout}
					images={group.images}
					key={`images_${group.images[0]?.id ?? "empty"}`}
					onImageClick={onImageClick}
				/>
			);
		}
		return (
			<GeneratedMediaItem
				className={className}
				classNames={classNames}
				key={group.media.id}
				media={group.media}
			/>
		);
	});

	if (classNames?.container) {
		return <div className={classNames.container}>{children}</div>;
	}
	return children;
}
