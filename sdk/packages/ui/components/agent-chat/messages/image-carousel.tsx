"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChatMessageImage } from "./chat-message.js";

export function MessageImageCarousel({
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
			<button
				aria-label={`Expand generated image ${safeIndex + 1}`}
				className="cursor-zoom-in overflow-hidden rounded-cline-ui-lg border border-cline-ui-border bg-cline-ui-muted text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cline-ui-ring"
				onClick={() => onExpandImage?.(image)}
				type="button"
			>
				<img
					alt={`Generated result ${safeIndex + 1}`}
					className="max-h-56.25 max-w-56.25 object-contain"
					src={`data:${image.mediaType};base64,${image.data}`}
				/>
			</button>
			{images.length > 1 ? (
				<>
					<button
						aria-label="Previous generated image"
						className="absolute left-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-cline-ui-border bg-cline-ui-background/85 text-cline-ui-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-cline-ui-background disabled:cursor-not-allowed disabled:opacity-35"
						disabled={safeIndex === 0}
						onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
						type="button"
					>
						<ChevronLeft className="size-4" />
					</button>
					<button
						aria-label="Next generated image"
						className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-cline-ui-border bg-cline-ui-background/85 text-cline-ui-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-cline-ui-background disabled:cursor-not-allowed disabled:opacity-35"
						disabled={safeIndex === lastIndex}
						onClick={() =>
							setActiveIndex((index) => Math.min(lastIndex, index + 1))
						}
						type="button"
					>
						<ChevronRight className="size-4" />
					</button>
					<div className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-cline-ui-background/85 px-2 py-0.5 text-[11px] text-cline-ui-foreground shadow-sm backdrop-blur-sm">
						{safeIndex + 1} / {images.length}
					</div>
				</>
			) : null}
		</div>
	);
}
