"use client";

import { Loader2, Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ChatMessageMedia } from "@/lib/chat-schema";
import { resolveDesktopBackendHttpEndpoint } from "@/lib/desktop-client";

export function videoArtifactId(media: ChatMessageMedia): string | undefined {
	return media.modality === "video" && media.source.type === "artifact"
		? media.source.artifactId
		: undefined;
}

export async function resolveSessionArtifactUrl(
	sessionId: string,
	artifactId: string,
): Promise<string> {
	const endpoint = await resolveDesktopBackendHttpEndpoint();
	return `${endpoint}/api/session-artifacts/${encodeURIComponent(sessionId)}/${encodeURIComponent(artifactId)}`;
}

function GeneratedVideo({
	sessionId,
	video,
	onExpandVideo,
}: {
	sessionId: string;
	video: ChatMessageMedia;
	onExpandVideo?: (video: ChatMessageMedia) => void;
}) {
	const [source, setSource] = useState<string | null>(null);
	const artifactId = videoArtifactId(video);

	useEffect(() => {
		if (!artifactId) return;
		let cancelled = false;
		void resolveSessionArtifactUrl(sessionId, artifactId).then((url) => {
			if (cancelled) return;
			setSource(url);
		});
		return () => {
			cancelled = true;
		};
	}, [sessionId, artifactId]);

	if (!artifactId) {
		return null;
	}

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
						<Maximize2 className="h-4 w-4" />
					</Button>
				</>
			) : (
				<div className="flex h-40 w-72 items-center justify-center text-sm text-muted-foreground">
					<Loader2 className="mr-2 size-4 animate-spin" />
					Loading video…
				</div>
			)}
		</div>
	);
}

/** Render artifact-backed generated videos served by the session host. */
export function MessageVideos({
	sessionId,
	videos,
	onExpandVideo,
}: {
	sessionId: string;
	videos: ChatMessageMedia[];
	onExpandVideo?: (video: ChatMessageMedia) => void;
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
