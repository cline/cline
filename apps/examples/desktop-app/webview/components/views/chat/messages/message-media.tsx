"use client";

import {
	AudioPlayer,
	AudioPlayerControlBar,
	AudioPlayerElement,
	AudioPlayerPlayButton,
	AudioPlayerTimeDisplay,
	AudioPlayerTimeRange,
} from "@cline/ui";
import { ChevronLeft, ChevronRight, Loader2, Maximize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
	ChatMessageAudio,
	ChatMessageImage,
	ChatMessageVideo,
} from "@/lib/chat-schema";
import { resolveDesktopBackendHttpEndpoint } from "@/lib/desktop-client";

export function MessageImages({
	images,
	isUser,
	onExpandImage,
}: {
	images: ChatMessageImage[];
	isUser: boolean;
	onExpandImage?: (image: ChatMessageImage) => void;
}) {
	if (!isUser) {
		return (
			<AssistantImageCarousel images={images} onExpandImage={onExpandImage} />
		);
	}

	return (
		<div className="grid max-w-2xl gap-2">
			{images.map((image, index) => (
				<ImageButton
					alt={`Attachment ${index + 1}`}
					ariaLabel={`Expand attachment ${index + 1}`}
					image={image}
					key={image.id}
					onExpandImage={onExpandImage}
				/>
			))}
		</div>
	);
}

function AssistantImageCarousel({
	images,
	onExpandImage,
}: {
	images: ChatMessageImage[];
	onExpandImage?: (image: ChatMessageImage) => void;
}) {
	const [activeIndex, setActiveIndex] = useState(0);
	const lastIndex = images.length - 1;
	const safeIndex = Math.min(activeIndex, lastIndex);
	const image = images[safeIndex];

	useEffect(() => {
		setActiveIndex((index) => Math.min(index, lastIndex));
	}, [lastIndex]);

	if (!image) return null;

	return (
		<div className="relative w-fit max-w-2xl">
			<ImageButton
				alt={`Generated result ${safeIndex + 1}`}
				ariaLabel={`Expand generated image ${safeIndex + 1}`}
				image={image}
				onExpandImage={onExpandImage}
			/>
			{images.length > 1 ? (
				<>
					<button
						aria-label="Previous generated image"
						className="absolute left-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-background disabled:cursor-not-allowed disabled:opacity-35"
						disabled={safeIndex === 0}
						onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
						type="button"
					>
						<ChevronLeft className="size-4" />
					</button>
					<button
						aria-label="Next generated image"
						className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-background disabled:cursor-not-allowed disabled:opacity-35"
						disabled={safeIndex === lastIndex}
						onClick={() =>
							setActiveIndex((index) => Math.min(lastIndex, index + 1))
						}
						type="button"
					>
						<ChevronRight className="size-4" />
					</button>
					<div className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-background/85 px-2 py-0.5 text-[11px] text-foreground shadow-sm backdrop-blur-sm">
						{safeIndex + 1} / {images.length}
					</div>
				</>
			) : null}
		</div>
	);
}

function ImageButton({
	alt,
	ariaLabel,
	image,
	onExpandImage,
}: {
	alt: string;
	ariaLabel: string;
	image: ChatMessageImage;
	onExpandImage?: (image: ChatMessageImage) => void;
}) {
	return (
		<button
			aria-label={ariaLabel}
			className="cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={() => onExpandImage?.(image)}
			type="button"
		>
			{/* biome-ignore lint/performance/noImgElement: In-memory data URLs cannot use Next's optimizer. */}
			<img
				alt={alt}
				className="max-h-56.25 max-w-56.25 object-contain"
				src={`data:${image.mediaType};base64,${image.data}`}
			/>
		</button>
	);
}

export function MessageVideos({
	sessionId,
	videos,
	onExpandVideo,
}: {
	sessionId: string;
	videos: ChatMessageVideo[];
	onExpandVideo?: (video: ChatMessageVideo) => void;
}) {
	return (
		<div className="grid max-w-2xl gap-2">
			{videos.map((video) => (
				<GeneratedVideo
					key={video.id}
					onExpandVideo={onExpandVideo}
					sessionId={sessionId}
					video={video}
				/>
			))}
		</div>
	);
}

export function ChatVideoLightbox({
	sessionId,
	video,
	onClose,
}: {
	sessionId: string;
	video: ChatMessageVideo;
	onClose: () => void;
}) {
	const source = useSessionArtifactSource(sessionId, video.artifactName);

	return (
		<div
			aria-label="Expanded generated video"
			aria-modal="true"
			className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
			role="dialog"
		>
			<button
				aria-label="Close expanded video"
				className="absolute inset-0 cursor-zoom-out"
				onClick={onClose}
				type="button"
			/>
			<div className="relative z-10 flex h-full w-full items-center justify-center">
				{source ? (
					// biome-ignore lint/a11y/useMediaCaption: Generated videos do not include a separate caption track.
					<video
						aria-label="Expanded generated video player"
						autoPlay
						className="max-h-full max-w-full rounded-lg bg-black shadow-2xl"
						controls
						playsInline
						src={source}
					/>
				) : (
					<LoadingArtifact label="Loading video…" />
				)}
				<Button
					aria-label="Close video viewer"
					className="absolute right-0 top-0 rounded-full"
					onClick={onClose}
					size="icon"
					type="button"
					variant="secondary"
				>
					<X className="size-4" />
				</Button>
			</div>
		</div>
	);
}

function GeneratedVideo({
	sessionId,
	video,
	onExpandVideo,
}: {
	sessionId: string;
	video: ChatMessageVideo;
	onExpandVideo?: (video: ChatMessageVideo) => void;
}) {
	const source = useSessionArtifactSource(sessionId, video.artifactName);

	return (
		<div className="relative w-fit max-w-2xl overflow-hidden rounded-lg border border-border bg-black">
			{source ? (
				<>
					{/* biome-ignore lint/a11y/useMediaCaption: Generated videos do not include a separate caption track. */}
					<video
						aria-label="Generated video"
						className="max-h-96 max-w-full"
						controls
						playsInline
						preload="metadata"
						src={source}
					/>
					<Button
						aria-label="Expand generated video"
						className="absolute right-2 top-2 rounded-full bg-background/85 shadow-md backdrop-blur-sm"
						onClick={() => onExpandVideo?.(video)}
						size="icon"
						type="button"
						variant="secondary"
					>
						<Maximize2 className="size-4" />
					</Button>
				</>
			) : (
				<LoadingArtifact label="Loading video…" />
			)}
		</div>
	);
}

export function MessageAudios({
	sessionId,
	audios,
}: {
	sessionId: string;
	audios: ChatMessageAudio[];
}) {
	return (
		<div className="grid max-w-2xl gap-2">
			{audios.map((audio) => (
				<GeneratedAudio audio={audio} key={audio.id} sessionId={sessionId} />
			))}
		</div>
	);
}

function GeneratedAudio({
	sessionId,
	audio,
}: {
	sessionId: string;
	audio: ChatMessageAudio;
}) {
	const source = useSessionArtifactSource(sessionId, audio.artifactName);

	return source ? (
		<AudioPlayer className="w-full max-w-md text-foreground">
			<AudioPlayerElement
				aria-label="Generated audio"
				muted={false}
				onPlay={(event) => {
					event.currentTarget.muted = false;
					if (event.currentTarget.volume === 0) {
						event.currentTarget.volume = 1;
					}
				}}
				preload="metadata"
				src={source}
			/>
			<AudioPlayerControlBar className="w-full">
				<AudioPlayerPlayButton aria-label="Play or pause generated audio" />
				<AudioPlayerTimeRange />
				<AudioPlayerTimeDisplay
					aria-label="Generated audio time remaining"
					noToggle
					remaining
				/>
			</AudioPlayerControlBar>
		</AudioPlayer>
	) : (
		<LoadingArtifact label="Loading audio…" />
	);
}

function LoadingArtifact({ label }: { label: string }) {
	return (
		<div className="flex h-40 w-72 items-center justify-center text-sm text-muted-foreground">
			<Loader2 className="mr-2 size-4 animate-spin" />
			{label}
		</div>
	);
}

function useSessionArtifactSource(
	sessionId: string,
	artifactName: string,
): string | null {
	const [source, setSource] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void resolveDesktopBackendHttpEndpoint().then((endpoint) => {
			if (cancelled) return;
			setSource(
				`${endpoint}/api/session-artifacts/${encodeURIComponent(sessionId)}/${encodeURIComponent(artifactName)}`,
			);
		});
		return () => {
			cancelled = true;
		};
	}, [artifactName, sessionId]);

	return source;
}
