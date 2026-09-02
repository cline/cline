"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatMessageMedia } from "@/lib/chat-schema";

export function ChatVideoLightbox({
	video,
	source,
	onClose,
}: {
	video: ChatMessageMedia;
	source: string;
	onClose: () => void;
}) {
	const videoName =
		video.source.type === "artifact"
			? video.source.artifactId
			: (video.name ?? "generated video");
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
				{/* biome-ignore lint/a11y/useMediaCaption: Generated videos do not include a separate caption track. */}
				<video
					aria-label="Expanded generated video player"
					autoPlay
					className="max-h-full max-w-full rounded-lg bg-black shadow-2xl"
					controls
					playsInline
					src={source}
				/>
				<Button
					aria-label={`Close ${videoName} viewer`}
					className="absolute right-0 top-0 rounded-full"
					onClick={onClose}
					size="icon"
					type="button"
					variant="secondary"
				>
					<X className="h-4 w-4" />
				</Button>
			</div>
		</div>
	);
}
