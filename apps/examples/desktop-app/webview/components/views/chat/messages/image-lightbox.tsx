"use client";

import { AgentImageLightboxContent } from "@cline/ui";

export function ChatImageLightbox({
	src,
	onClose,
}: {
	src: string;
	onClose: () => void;
}) {
	return (
		<div
			aria-label="Expanded attachment"
			aria-modal="true"
			className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
			role="dialog"
		>
			<AgentImageLightboxContent
				src={src}
				alt="Expanded attachment"
				onClose={onClose}
			/>
		</div>
	);
}
