"use client";

import type { SpeechResult } from "ai";
import {
	MediaControlBar,
	MediaController,
	MediaPlayButton,
	MediaTimeDisplay,
	MediaTimeRange,
} from "media-chrome/react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";

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
			className={cn("cline-audio-player", className)}
			data-slot="audio-player"
			{...props}
		>
			{children}
		</MediaController>
	);
}

export type AudioPlayerElementProps = Omit<ComponentProps<"audio">, "src"> &
	({ data: SpeechResult["audio"] } | { src: string });

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
	...props
}: AudioPlayerControlBarProps) {
	return (
		<MediaControlBar data-slot="audio-player-control-bar" {...props}>
			<ButtonGroup className="w-full" orientation="horizontal">
				{children}
			</ButtonGroup>
		</MediaControlBar>
	);
}

export type AudioPlayerPlayButtonProps = ComponentProps<typeof MediaPlayButton>;

export function AudioPlayerPlayButton({
	className,
	...props
}: AudioPlayerPlayButtonProps) {
	return (
		<Button
			asChild
			className="size-8 border border-input bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent"
			size="icon-lg"
			variant="ghost"
		>
			<MediaPlayButton
				className={cn(
					"size-2 bg-transparent [--media-button-icon-height:0.8rem] [--media-button-icon-width:1rem]",
					className,
				)}
				data-slot="audio-player-play-button"
				{...props}
			/>
		</Button>
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
		<ButtonGroupText asChild className="h-8 bg-transparent px-2">
			<MediaTimeDisplay
				className={cn("tabular-nums", className)}
				data-slot="audio-player-time-display"
				{...props}
			/>
		</ButtonGroupText>
	);
}

export type AudioPlayerTimeRangeProps = ComponentProps<typeof MediaTimeRange>;

export function AudioPlayerTimeRange({
	className,
	...props
}: AudioPlayerTimeRangeProps) {
	return (
		<ButtonGroupText
			asChild
			className="h-8 min-w-20 flex-1 bg-transparent px-2"
		>
			<MediaTimeRange
				className={cn("w-full", className)}
				data-slot="audio-player-time-range"
				{...props}
			/>
		</ButtonGroupText>
	);
}
