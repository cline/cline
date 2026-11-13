"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export function Modal({
	open,
	onClose,
	title,
	description,
	children,
	width = "max-w-lg",
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	description?: string;
	children: React.ReactNode;
	width?: string;
}) {
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = "";
		};
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
			<button
				type="button"
				aria-label="Close dialog"
				onClick={onClose}
				className="fixed inset-0 bg-black/70 backdrop-blur-sm"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className={cn(
					"relative z-10 my-8 w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-850 shadow-lift animate-rise",
					width,
				)}
			>
				<div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
					<div>
						<h2 className="font-display text-base font-semibold">{title}</h2>
						{description ? <p className="mt-1 text-xs text-mist-500">{description}</p> : null}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="btn btn-ghost size-8 px-0"
						aria-label="Close"
					>
						<X className="size-4" />
					</button>
				</div>
				<div className="px-5 py-5">{children}</div>
			</div>
		</div>
	);
}
