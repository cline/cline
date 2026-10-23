import {
	type GeneratedMedia,
	createMediaBudgetState,
	validateAndReserveBase64Media,
} from "@cline/shared";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { Button, Text } from "@/ui";

const INLINE_MEDIA_EXTENSIONS: Record<string, string> = {
	"audio/mpeg": "mp3",
	"audio/mp3": "mp3",
	"audio/mp4": "m4a",
	"audio/aac": "aac",
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/ogg": "ogg",
	"audio/webm": "webm",
	"video/mp4": "mp4",
	"video/webm": "webm",
	"video/quicktime": "mov",
};

/** Mounted only after a load request; native players never autoplay. */
export function GeneratedMediaPlayback({ media }: { media: GeneratedMedia }) {
	const [attempt, setAttempt] = useState(0);
	return (
		<PreparedPlayback
			key={attempt}
			media={media}
			onRetry={() => setAttempt((value) => value + 1)}
		/>
	);
}

function PreparedPlayback({
	media,
	onRetry,
}: {
	media: GeneratedMedia;
	onRetry(): void;
}) {
	const [uri, setUri] = useState<string>();
	const [error, setError] = useState(false);
	const remoteUri = media.source.type === "url" ? media.source.url : undefined;
	const inlineData =
		media.source.type === "base64" ? media.source.data : undefined;
	useEffect(() => {
		setUri(undefined);
		setError(false);
		if (remoteUri) {
			setUri(remoteUri);
			return;
		}
		if (inlineData === undefined) return;
		const extension = INLINE_MEDIA_EXTENSIONS[media.mediaType.toLowerCase()];
		const validated = validateAndReserveBase64Media(
			inlineData,
			{ maxTotalMediaBytes: 8 * 1024 * 1024 },
			createMediaBudgetState(),
		);
		if (!extension || !validated.ok) {
			setError(true);
			return;
		}
		// Native AV players need a file URL for inline bytes. Bound the write and
		// remove our private cache file when its playback surface is released.
		const file = new File(
			Paths.cache,
			`generated-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`,
		);
		try {
			file.create();
			file.write(validated.base64, { encoding: "base64" });
			setUri(file.uri);
		} catch {
			setError(true);
		}
		return () => {
			try {
				if (file.exists) file.delete();
			} catch {
				/* The OS may already have cleared its cache. */
			}
		};
	}, [media.mediaType, remoteUri, inlineData]);
	if (error)
		return <PlaybackError modality={media.modality} onRetry={onRetry} />;
	if (!uri) return <Text tone="muted">Loading {media.modality}…</Text>;
	return media.modality === "audio" ? (
		<AudioPlayback uri={uri} onRetry={onRetry} />
	) : (
		<VideoPlayback uri={uri} onRetry={onRetry} />
	);
}

function usePauseWhenInactive(player: { pause(): void }) {
	const focused = useRef(true);
	const pause = useCallback(() => {
		try {
			player.pause();
		} catch {
			// Expo releases its native handle before later unmount cleanups run.
		}
	}, [player]);
	useFocusEffect(
		useCallback(() => {
			focused.current = true;
			return () => {
				focused.current = false;
				pause();
			};
		}, [pause]),
	);
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") pause();
		});
		return () => subscription.remove();
	}, [pause]);
	return () => focused.current && AppState.currentState === "active";
}

function AudioPlayback({ uri, onRetry }: { uri: string; onRetry(): void }) {
	const player = useAudioPlayer(uri);
	const status = useAudioPlayerStatus(player);
	const [failed, setFailed] = useState(false);
	const canPlay = usePauseWhenInactive(player);
	if (failed || status.error)
		return <PlaybackError modality="audio" onRetry={onRetry} />;
	const toggle = async () => {
		try {
			if (status.playing) player.pause();
			else {
				if (
					status.didJustFinish ||
					(status.duration > 0 && status.currentTime >= status.duration)
				)
					await player.seekTo(0);
				if (canPlay()) player.play();
			}
		} catch {
			setFailed(true);
		}
	};
	return (
		<View style={{ gap: 8 }}>
			<Text variant="small" tone="muted">
				{status.isLoaded
					? `${Math.floor(status.currentTime)}s / ${Math.floor(status.duration)}s`
					: "Loading audio…"}
			</Text>
			<Button
				label={status.playing ? "Pause audio" : "Play audio"}
				disabled={!status.isLoaded}
				onPress={() => void toggle()}
			/>
		</View>
	);
}

function VideoPlayback({ uri, onRetry }: { uri: string; onRetry(): void }) {
	const player = useVideoPlayer(uri, (player) => {
		player.staysActiveInBackground = false;
		player.allowsExternalPlayback = false;
	});
	const [status, setStatus] = useState(player.status);
	usePauseWhenInactive(player);
	useEffect(() => {
		const subscription = player.addListener("statusChange", (event) =>
			setStatus(event.status),
		);
		return () => subscription.remove();
	}, [player]);
	if (status === "error")
		return <PlaybackError modality="video" onRetry={onRetry} />;
	return (
		<View style={{ gap: 8 }}>
			{status === "loading" ? <Text tone="muted">Loading video…</Text> : null}
			<VideoView
				player={player}
				nativeControls
				allowsPictureInPicture={false}
				fullscreenOptions={{ enable: true, orientation: "default" }}
				style={{ width: "100%", aspectRatio: 16 / 9 }}
			/>
		</View>
	);
}

function PlaybackError({
	modality,
	onRetry,
}: {
	modality: string;
	onRetry(): void;
}) {
	return (
		<View style={{ gap: 8 }}>
			<Text variant="small" tone="muted" accessibilityRole="alert">
				This {modality} could not be played. Check your connection or try
				another format. Inline media is limited to 8 MB.
			</Text>
			<Button label={`Retry ${modality}`} variant="outline" onPress={onRetry} />
		</View>
	);
}
