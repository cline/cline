"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { clsx } from "clsx";
import { X } from "lucide-react";
import {
	type ComponentProps,
	type CSSProperties,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import { IconButton } from "./button.js";
import { useDialogFocus } from "./dialog-focus.js";
import { hasContent } from "./has-content.js";

type ContentProps = ComponentProps<typeof DialogPrimitive.Content>;

export interface DialogProps
	extends Pick<
		ContentProps,
		| "onOpenAutoFocus"
		| "onCloseAutoFocus"
		| "onEscapeKeyDown"
		| "onPointerDownOutside"
		| "onInteractOutside"
	> {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Display content used as the accessible dialog name. */
	title: ReactNode;
	/** Optional content above the title, outside the accessible dialog name. */
	eyebrow?: ReactNode;
	/** Optional accessible description; supports multiple paragraphs. */
	description?: ReactNode;
	children?: ReactNode;
	/** Host-owned actions. Buttons do not dismiss the dialog automatically. */
	footer?: ReactNode;
	size?: "sm" | "md" | "lg";
	showCloseButton?: boolean;
	/** Allow Escape, outside interactions, and close-button dismissal. Defaults to true. */
	dismissible?: boolean;
	/** Contained bodies fill available space and let their children own scrolling. */
	bodyLayout?: "scroll" | "contained";
	/** Mount inside a themed wrapper when the host uses scoped tokens. */
	portalContainer?: ComponentProps<typeof DialogPrimitive.Portal>["container"];
	className?: string;
	bodyClassName?: string;
	/** Customize the header for branded introductions, without replacing its semantics. */
	headerClassName?: string;
	headerStyle?: CSSProperties;
}

/** Controlled content dialog. The host owns actions, pending state, and dismissal policy. */
export function Dialog({
	open,
	onOpenChange,
	title,
	eyebrow,
	description,
	children,
	footer,
	size = "md",
	showCloseButton = true,
	dismissible = true,
	bodyLayout = "scroll",
	portalContainer,
	className,
	bodyClassName,
	headerClassName,
	headerStyle,
	onOpenAutoFocus,
	onCloseAutoFocus,
	onEscapeKeyDown,
	onPointerDownOutside,
	onInteractOutside,
}: DialogProps) {
	const focus = useDialogFocus({
		focusContent: true,
		onOpenAutoFocus,
		onCloseAutoFocus,
	});
	const hasDescription = hasContent(description);
	const [header, setHeader] = useState<HTMLDivElement | null>(null);
	const [headerScrollable, setHeaderScrollable] = useState(false);

	useEffect(() => {
		if (!header) return;
		const update = () => {
			const overflow = getComputedStyle(header).overflowY;
			setHeaderScrollable(
				(overflow === "auto" || overflow === "scroll") &&
					header.scrollHeight > header.clientHeight,
			);
		};
		update();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(update);
		observer.observe(header);
		// The header can stay capped while its title or description grows.
		const titleElement = header.querySelector('[data-slot="dialog-title"]');
		if (titleElement) observer.observe(titleElement);
		if (hasDescription) {
			const descriptionElement = header.querySelector(
				'[data-slot="dialog-description"]',
			);
			if (descriptionElement) observer.observe(descriptionElement);
		}
		return () => observer.disconnect();
	}, [header, hasDescription]);

	return (
		<DialogPrimitive.Root
			open={open}
			onOpenChange={(nextOpen) => {
				if (nextOpen || dismissible) onOpenChange(nextOpen);
			}}
		>
			<DialogPrimitive.Portal container={portalContainer}>
				<DialogPrimitive.Overlay
					className="cline-dialog__overlay"
					data-slot="dialog-overlay"
				/>
				<DialogPrimitive.Content
					{...(!hasDescription ? { "aria-describedby": undefined } : {})}
					className={clsx("cline-dialog__content", className)}
					data-has-close={showCloseButton}
					data-size={size}
					data-slot="dialog-content"
					onOpenAutoFocus={focus.onOpenAutoFocus}
					onCloseAutoFocus={focus.onCloseAutoFocus}
					onEscapeKeyDown={(event) => {
						onEscapeKeyDown?.(event);
						if (!dismissible) event.preventDefault();
					}}
					onPointerDownOutside={(event) => {
						onPointerDownOutside?.(event);
						if (!dismissible) event.preventDefault();
					}}
					onInteractOutside={(event) => {
						onInteractOutside?.(event);
						if (!dismissible) event.preventDefault();
					}}
					ref={focus.contentRef}
				>
					<div
						className={clsx("cline-dialog__header", headerClassName)}
						data-slot="dialog-header"
						ref={setHeader}
						style={headerStyle}
						// Only overflowing, visible headers need a keyboard scroll target.
						tabIndex={headerScrollable ? 0 : undefined}
					>
						{eyebrow}
						<DialogPrimitive.Title
							className="cline-dialog__title"
							data-slot="dialog-title"
						>
							{title}
						</DialogPrimitive.Title>
						{hasDescription ? (
							<DialogPrimitive.Description asChild>
								<div
									className="cline-dialog__description"
									data-slot="dialog-description"
								>
									{description}
								</div>
							</DialogPrimitive.Description>
						) : null}
					</div>
					{hasContent(children) ? (
						<div
							className={clsx("cline-dialog__body", bodyClassName)}
							data-slot="dialog-body"
							data-layout={bodyLayout}
							role="document"
							// Only the scroll-owning body needs a keyboard scroll target.
							tabIndex={bodyLayout === "scroll" ? 0 : undefined}
						>
							{children}
						</div>
					) : null}
					{hasContent(footer) ? (
						<div className="cline-dialog__footer" data-slot="dialog-footer">
							{footer}
						</div>
					) : null}
					{showCloseButton ? (
						<IconButton
							asChild
							aria-label="Close"
							icon={X}
							disabled={!dismissible}
							className="cline-dialog__close"
							size="sm"
							tone="neutral"
							variant="ghost"
						>
							<DialogPrimitive.Close
								data-slot="dialog-close"
								disabled={!dismissible}
							/>
						</IconButton>
					) : null}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
