import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "./button.js";
export function ConfirmDialog({ cancelLabel = "Cancel", confirmLabel = "Confirm", danger = false, description, loading = false, onConfirm, onOpenChange, open, title, }) {
    return (_jsx(Dialog.Root, { onOpenChange: (nextOpen) => {
            if (!nextOpen && loading)
                return;
            onOpenChange(nextOpen);
        }, open: open, children: _jsxs(Dialog.Portal, { children: [_jsx(Dialog.Overlay, { className: "cline-ui-theme cline-ui-dialog__overlay" }), _jsxs(Dialog.Content, { className: "cline-ui-theme cline-ui-dialog__content", onEscapeKeyDown: (event) => {
                        if (loading)
                            event.preventDefault();
                    }, onInteractOutside: (event) => {
                        if (loading)
                            event.preventDefault();
                    }, children: [_jsx(Dialog.Title, { className: "cline-ui-dialog__title", children: title }), description ? (_jsx(Dialog.Description, { className: "cline-ui-dialog__description", children: description })) : null, _jsxs("div", { className: "cline-ui-dialog__actions", children: [_jsx(Dialog.Close, { asChild: true, children: _jsx(Button, { disabled: loading, size: "sm", variant: "secondary", children: cancelLabel }) }), _jsx(Button, { loading: loading, onClick: onConfirm, size: "sm", variant: danger ? "danger" : "primary", children: confirmLabel })] })] })] }) }));
}
//# sourceMappingURL=confirm-dialog.js.map