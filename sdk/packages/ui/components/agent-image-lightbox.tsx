"use client";

import { X } from "lucide-react";
import { IconButton } from "./button.js";

export interface AgentImageLightboxContentProps {
	/** Host-approved image URL; resolve untrusted provider URLs before passing them here. */
	src: string;
	alt: string;
	onClose: () => void;
	/** Hosts with a focus-managed dialog can omit its backdrop from tab order. */
	backdropTabIndex?: number;
}

/** Image presentation; the host owns the dialog, positioning, and keyboard focus. */
export function AgentImageLightboxContent({
	src,
	alt,
	onClose,
	backdropTabIndex,
}: AgentImageLightboxContentProps) {
	return (
		<>
			<button
				aria-label="Close expanded attachment"
				className="absolute inset-0 cursor-zoom-out"
				onClick={onClose}
				tabIndex={backdropTabIndex}
				type="button"
			/>
			<div className="pointer-events-none relative z-10 flex h-full w-full items-center justify-center">
				<img
					alt={alt}
					className="max-h-full max-w-full rounded-cline-ui-lg object-contain shadow-2xl"
					src={src}
				/>
				<IconButton
					aria-label="Close image viewer"
					className="pointer-events-auto absolute right-0 top-0 rounded-full"
					icon={X}
					onClick={onClose}
					size="xs"
					variant="secondary"
				/>
			</div>
		</>
	);
}
