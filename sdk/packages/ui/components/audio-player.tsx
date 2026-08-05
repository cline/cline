"use client";

import {
	MediaControlBar,
	MediaController,
	MediaPlayButton,
	MediaTimeDisplay,
	MediaTimeRange,
} from "media-chrome/react";
import type { ComponentProps } from "react";

function classes(...values: Array<string | undefined>): string {
	return values.filter(Boolean).join(" ");
}

export type AudioPlayerProps = Omit<
	ComponentProps<typeof MediaController>,
	"audio"
>;

export function AudioPlayer({
	children,
	className,
	...props
}: AudioPlayerProps) {
	return (
		<MediaController
			audio
			className={classes("cline-ui-audio-player", className)}
			data-slot="audio-player"
			{...props}
		>
			{children}
		</MediaController>
	);
}

export interface AudioPlayerData {
	base64: string;
	mediaType: string;
}

export type AudioPlayerElementProps = Omit<ComponentProps<"audio">, "src"> &
	({ data: AudioPlayerData } | { src: string });

export function AudioPlayerElement(props: AudioPlayerElementProps) {
	if ("src" in props) {
		return <audio data-slot="audio-player-element" slot="media" {...props} />;
	}

	const { data, ...audioProps } = props;
	return (
		<audio
			data-slot="audio-player-element"
			slot="media"
			src={`data:${data.mediaType};base64,${data.base64}`}
			{...audioProps}
		/>
	);
}

export type AudioPlayerControlBarProps = ComponentProps<typeof MediaControlBar>;

export function AudioPlayerControlBar({
	children,
	className,
	...props
}: AudioPlayerControlBarProps) {
	return (
		<MediaControlBar
			className={classes("cline-ui-audio-player__controls", className)}
			data-slot="audio-player-control-bar"
			{...props}
		>
			{children}
		</MediaControlBar>
	);
}

export type AudioPlayerPlayButtonProps = ComponentProps<typeof MediaPlayButton>;

export function AudioPlayerPlayButton({
	className,
	...props
}: AudioPlayerPlayButtonProps) {
	return (
		<MediaPlayButton
			className={classes("cline-ui-audio-player__play", className)}
			data-slot="audio-player-play-button"
			{...props}
		/>
	);
}

export type AudioPlayerTimeDisplayProps = ComponentProps<
	typeof MediaTimeDisplay
>;

export function AudioPlayerTimeDisplay({
	className,
	...props
}: AudioPlayerTimeDisplayProps) {
	return (
		<MediaTimeDisplay
			className={classes("cline-ui-audio-player__time", className)}
			data-slot="audio-player-time-display"
			{...props}
		/>
	);
}

export type AudioPlayerTimeRangeProps = ComponentProps<typeof MediaTimeRange>;

export function AudioPlayerTimeRange({
	className,
	...props
}: AudioPlayerTimeRangeProps) {
	return (
		<MediaTimeRange
			className={classes("cline-ui-audio-player__range", className)}
			data-slot="audio-player-time-range"
			{...props}
		/>
	);
}
