import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useState } from "react";
import { cx } from "./utils.js";
export function AgentActivity({ children, className, defaultOpen = false, detail, icon, label, status = "idle", }) {
    const [open, setOpen] = useState(defaultOpen);
    const content = detail ?? children;
    return (_jsxs(Collapsible.Root, { className: cx("cline-ui-activity", `cline-ui-activity--${status}`, className), onOpenChange: setOpen, open: open, children: [_jsxs(Collapsible.Trigger, { className: "cline-ui-activity__trigger", disabled: !content, children: [_jsx("span", { className: "cline-ui-activity__icon", children: status === "running" ? (_jsx("span", { "aria-hidden": "true", className: "cline-ui-spinner" })) : (icon) }), _jsx("span", { className: "cline-ui-activity__label", children: label }), content ? (_jsx("svg", { "aria-hidden": "true", className: cx("cline-ui-activity__chevron", open && "cline-ui-activity__chevron--open"), fill: "none", viewBox: "0 0 16 16", children: _jsx("path", { d: "m4 6 4 4 4-4", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.5" }) })) : null] }), content ? (_jsx(Collapsible.Content, { className: "cline-ui-activity__content", children: content })) : null] }));
}
//# sourceMappingURL=agent-activity.js.map