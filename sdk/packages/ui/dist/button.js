import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Slot } from "@radix-ui/react-slot";
import { Children, cloneElement, forwardRef } from "react";
import { cx } from "./utils.js";
export const Button = forwardRef(function Button({ asChild = false, children, className, disabled, iconOnly = false, loading = false, onClick, size = "md", type = "button", variant = "secondary", ...props }, ref) {
    const classNames = cx("cline-ui-button", `cline-ui-button--${variant}`, `cline-ui-button--${size}`, iconOnly && "cline-ui-button--icon", className);
    if (asChild) {
        const inactive = disabled || loading;
        const child = Children.only(children);
        return (_jsx(Slot, { "aria-busy": loading || undefined, "aria-disabled": inactive || undefined, className: classNames, onClick: (event) => {
                if (inactive) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                onClick?.(event);
            }, ref: ref, ...props, children: inactive ? cloneElement(child, { onClick: undefined }) : child }));
    }
    return (_jsxs("button", { "aria-busy": loading || undefined, className: classNames, disabled: disabled || loading, onClick: onClick, ref: ref, type: type, ...props, children: [loading ? (_jsx("span", { "aria-hidden": "true", className: "cline-ui-spinner" })) : null, children] }));
});
//# sourceMappingURL=button.js.map