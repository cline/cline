"use client";

import { clsx } from "clsx";
import {
	forwardRef,
	type HTMLAttributes,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

export interface AttachmentDropZoneProps
	extends Omit<
		HTMLAttributes<HTMLDivElement>,
		"onDragEnter" | "onDragLeave" | "onDragOver" | "onDrop"
	> {
	children: ReactNode;
	description?: ReactNode;
	disabled?: boolean;
	label?: ReactNode;
	onAttachFiles: (files: File[]) => void;
}

function includesFiles(event: React.DragEvent<HTMLDivElement>): boolean {
	return event.dataTransfer.types.includes("Files");
}

function ImagePlusIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-8 text-cline-ui-primary"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<path d="M16 5h6" />
			<path d="M19 2v6" />
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
			<circle cx="9" cy="9" r="2" />
			<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
		</svg>
	);
}

/**
 * Adds OS file drag-and-drop to an existing attachment surface.
 *
 * The consumer remains responsible for validating and storing the dropped files.
 */
export const AttachmentDropZone = forwardRef<
	HTMLDivElement,
	AttachmentDropZoneProps
>(
	(
		{
			children,
			className,
			description = "Screenshots and files will be added to your next message",
			disabled = false,
			label = "Drop to attach",
			onAttachFiles,
			...props
		},
		ref,
	) => {
		const [isDraggingFiles, setIsDraggingFiles] = useState(false);
		const dragDepthRef = useRef(0);

		useEffect(() => {
			if (!disabled) return;
			dragDepthRef.current = 0;
			setIsDraggingFiles(false);
		}, [disabled]);

		const handleDragEnter = useCallback(
			(event: React.DragEvent<HTMLDivElement>) => {
				if (!includesFiles(event)) return;
				event.preventDefault();
				if (disabled) return;
				dragDepthRef.current += 1;
				setIsDraggingFiles(true);
			},
			[disabled],
		);

		const handleDragOver = useCallback(
			(event: React.DragEvent<HTMLDivElement>) => {
				if (!includesFiles(event)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = disabled ? "none" : "copy";
			},
			[disabled],
		);

		const handleDragLeave = useCallback(
			(event: React.DragEvent<HTMLDivElement>) => {
				if (disabled || !includesFiles(event)) return;
				dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
				if (dragDepthRef.current === 0) setIsDraggingFiles(false);
			},
			[disabled],
		);

		const handleDrop = useCallback(
			(event: React.DragEvent<HTMLDivElement>) => {
				if (!includesFiles(event)) return;
				event.preventDefault();
				dragDepthRef.current = 0;
				setIsDraggingFiles(false);
				if (disabled) return;
				const files = Array.from(event.dataTransfer.files);
				if (files.length > 0) onAttachFiles(files);
			},
			[disabled, onAttachFiles],
		);

		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: The drop zone augments the consumer's accessible file picker.
			<div
				{...props}
				className={clsx("relative", className)}
				data-dragging-files={isDraggingFiles || undefined}
				data-slot="attachment-drop-zone"
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
				ref={ref}
			>
				{isDraggingFiles ? (
					<div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-cline-ui-background/80 backdrop-blur-sm">
						<div className="flex flex-col items-center gap-2 rounded-cline-ui-xl border-2 border-cline-ui-primary/60 border-dashed bg-cline-ui-card px-10 py-8 shadow-lg">
							<ImagePlusIcon />
							<p className="font-cline-ui-medium text-cline-ui-foreground text-cline-ui-sm">
								{label}
							</p>
							<p className="text-cline-ui-muted-foreground text-cline-ui-xs">
								{description}
							</p>
						</div>
					</div>
				) : null}
				{children}
			</div>
		);
	},
);
AttachmentDropZone.displayName = "AttachmentDropZone";
