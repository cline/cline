import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Slot } from "@radix-ui/react-slot";
import { forwardRef } from "react";
import { cx } from "./utils.js";
export const Button = forwardRef(function Button({ asChild = false, children, className, disabled, iconOnly = false, loading = false, size = "md", type = "button", variant = "secondary", ...props }, ref) {
    const classNames = cx("cline-ui-button", `cline-ui-button--${variant}`, `cline-ui-button--${size}`, iconOnly && "cline-ui-button--icon", className);
    if (asChild) {
        return (_jsx(Slot, { "aria-busy": loading || undefined, className: classNames, ref: ref, ...props, children: children }));
    }
    return (_jsxs("button", { "aria-busy": loading || undefined, className: classNames, disabled: disabled || loading, ref: ref, type: type, ...props, children: [loading ? (_jsx("span", { "aria-hidden": "true", className: "cline-ui-spinner" })) : null, children] }));
});
//# sourceMappingURL=button.js.map