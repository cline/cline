import type { ReactNode } from "react";
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
export declare function ConfirmDialog({ cancelLabel, confirmLabel, danger, description, loading, onConfirm, onOpenChange, open, title, }: ConfirmDialogProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=confirm-dialog.d.ts.map