import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { Button } from "./button.js";

export interface ConfirmDialogProps {
	cancelLabel?: string;
	confirmLabel?: string;
	danger?: boolean;
	description?: ReactNode;
	loading?: boolean;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: ReactNode;
}

export function ConfirmDialog({
	cancelLabel = "Cancel",
	confirmLabel = "Confirm",
	danger = false,
	description,
	loading = false,
	onConfirm,
	onOpenChange,
	open,
	title,
}: ConfirmDialogProps) {
	return (
		<Dialog.Root onOpenChange={onOpenChange} open={open}>
			<Dialog.Portal>
				<Dialog.Overlay className="cline-ui-dialog__overlay" />
				<Dialog.Content className="cline-ui-dialog__content">
					<Dialog.Title className="cline-ui-dialog__title">
						{title}
					</Dialog.Title>
					{description ? (
						<Dialog.Description className="cline-ui-dialog__description">
							{description}
						</Dialog.Description>
					) : null}
					<div className="cline-ui-dialog__actions">
						<Dialog.Close asChild>
							<Button disabled={loading} size="sm" variant="secondary">
								{cancelLabel}
							</Button>
						</Dialog.Close>
						<Button
							loading={loading}
							onClick={onConfirm}
							size="sm"
							variant={danger ? "danger" : "primary"}
						>
							{confirmLabel}
						</Button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
