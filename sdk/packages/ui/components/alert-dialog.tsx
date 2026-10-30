"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps, MouseEventHandler, ReactNode } from "react";
import { Button, type ButtonTone } from "./button.js";
import { useDialogFocus } from "./dialog-focus.js";

export interface AlertDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	/** Supports multiple paragraphs; rendered inside an accessible description div. */
	description: ReactNode;
	confirmLabel: ReactNode;
	/** Call preventDefault() to keep the dialog open while the host handles an action. */
	onConfirm: MouseEventHandler<HTMLButtonElement>;
	cancelLabel?: ReactNode;
	onCancel?: MouseEventHandler<HTMLButtonElement>;
	confirmTone?: ButtonTone;
	confirmDisabled?: boolean;
	cancelDisabled?: boolean;
	/** Mount inside a themed wrapper when the host uses scoped tokens. */
	portalContainer?: ComponentProps<
		typeof AlertDialogPrimitive.Portal
	>["container"];
	/** Optional details between the description and actions, such as a destination URL. */
	children?: ReactNode;
}

/** Controlled confirmation UI. The host owns actions, pending state, and errors. */
export function AlertDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	onConfirm,
	cancelLabel = "Cancel",
	onCancel,
	confirmTone = "neutral",
	confirmDisabled = false,
	cancelDisabled = false,
	portalContainer,
	children,
}: AlertDialogProps) {
	const focus = useDialogFocus({
		// Radix focuses Cancel unless it is disabled; keep pending dialogs focused.
		focusContent: cancelDisabled,
	});

	return (
		<AlertDialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
			<AlertDialogPrimitive.Portal container={portalContainer}>
				<AlertDialogPrimitive.Overlay
					className="cline-dialog__overlay"
					data-slot="alert-dialog-overlay"
				/>
				<AlertDialogPrimitive.Content
					className="cline-dialog__content"
					data-size="sm"
					data-slot="alert-dialog-content"
					onCloseAutoFocus={focus.onCloseAutoFocus}
					onOpenAutoFocus={focus.onOpenAutoFocus}
					onFocusCapture={focus.onFocusCapture}
					ref={focus.contentRef}
				>
					<div
						className="cline-dialog__body cline-dialog__body--with-header"
						data-slot="alert-dialog-body"
						role="document"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus the body to scroll it independently of the actions.
						tabIndex={0}
					>
						<div className="cline-dialog__header">
							<AlertDialogPrimitive.Title className="cline-dialog__title">
								{title}
							</AlertDialogPrimitive.Title>
							<AlertDialogPrimitive.Description asChild>
								<div className="cline-dialog__description">{description}</div>
							</AlertDialogPrimitive.Description>
						</div>
						{children}
					</div>
					<div className="cline-dialog__footer" data-slot="alert-dialog-footer">
						<AlertDialogPrimitive.Cancel asChild>
							<Button
								disabled={cancelDisabled}
								onClick={onCancel}
								size="sm"
								tone="neutral"
								variant="secondary"
							>
								{cancelLabel}
							</Button>
						</AlertDialogPrimitive.Cancel>
						<AlertDialogPrimitive.Action asChild>
							<Button
								disabled={confirmDisabled}
								onClick={onConfirm}
								size="sm"
								tone={confirmTone}
								variant="primary"
							>
								{confirmLabel}
							</Button>
						</AlertDialogPrimitive.Action>
					</div>
				</AlertDialogPrimitive.Content>
			</AlertDialogPrimitive.Portal>
		</AlertDialogPrimitive.Root>
	);
}
