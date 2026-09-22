"use client";

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
				<button
					aria-label="Close image viewer"
					className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-cline-ui-ring focus-visible:ring-cline-ui-ring/50 focus-visible:ring-[3px] aria-invalid:ring-cline-ui-destructive/20 cline-ui-dark:aria-invalid:ring-cline-ui-destructive/40 aria-invalid:border-cline-ui-destructive bg-cline-ui-secondary text-cline-ui-secondary-foreground hover:bg-cline-ui-surface-hover size-5 pointer-events-auto absolute right-0 top-0 rounded-full"
					data-slot="button"
					onClick={onClose}
					type="button"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="lucide lucide-x h-4 w-4"
						aria-hidden="true"
					>
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</svg>
				</button>
			</div>
		</>
	);
}
