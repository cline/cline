"use client";

import {
	AudioPlayer,
	AudioPlayerControlBar,
	AudioPlayerElement,
	AudioPlayerPlayButton,
	AudioPlayerTimeDisplay,
	AudioPlayerTimeRange,
} from "@cline/ui";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChatMessageMedia } from "@/lib/chat-schema";
import { resolveSessionArtifactUrl } from "./message-videos";

export function audioArtifactId(media: ChatMessageMedia): string | undefined {
	return media.modality === "audio" && media.source.type === "artifact"
		? media.source.artifactId
		: undefined;
}

function GeneratedAudio({
	sessionId,
	audio,
}: {
	sessionId: string;
	audio: ChatMessageMedia;
}) {
	const [source, setSource] = useState<string | null>(null);
	const artifactId = audioArtifactId(audio);

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

	return source ? (
		<div className="max-w-md space-y-1">
			<AudioPlayer className="w-full text-foreground">
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
		</div>
	) : (
		<div className="flex h-10 w-72 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
			<Loader2 className="mr-2 size-4 animate-spin" />
			Loading audio…
		</div>
	);
}

/** Render artifact-backed generated audio served by the session host. */
export function MessageAudios({
	sessionId,
	audios,
}: {
	sessionId: string;
	audios: ChatMessageMedia[];
}) {
	return (
		<div className="grid max-w-2xl gap-2">
			{audios.map((audio) => (
				<GeneratedAudio audio={audio} key={audio.id} sessionId={sessionId} />
			))}
		</div>
	);
}
