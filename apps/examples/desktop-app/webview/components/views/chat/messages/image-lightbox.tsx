"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatMessageImage } from "@/lib/chat-schema";

export function ChatImageLightbox({
	image,
	onClose,
}: {
	image: ChatMessageImage;
	onClose: () => void;
}) {
	return (
		<div
			aria-label="Expanded attachment"
			aria-modal="true"
			className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
			role="dialog"
		>
			<button
				aria-label="Close expanded attachment"
				className="absolute inset-0 cursor-zoom-out"
				onClick={onClose}
				type="button"
			/>
			<div className="pointer-events-none relative z-10 flex h-full w-full items-center justify-center">
				{/* biome-ignore lint/performance/noImgElement: User-provided data URLs cannot use Next's optimizer. */}
				<img
					alt="Expanded attachment"
					className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
					src={`data:${image.mediaType};base64,${image.data}`}
				/>
				<Button
					aria-label="Close image viewer"
					className="pointer-events-auto absolute right-0 top-0 rounded-full"
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
