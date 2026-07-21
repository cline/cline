import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cx } from "./utils.js";
export function SessionStatus({ className, label, showLabel = true, tone = "neutral", ...props }) {
    return (_jsxs("output", { "aria-label": label, className: cx("cline-ui-session-status", `cline-ui-session-status--${tone}`, className), ...props, children: [_jsx("span", { "aria-hidden": "true", className: "cline-ui-session-status__dot" }), _jsx("span", { className: showLabel ? undefined : "cline-ui-sr-only", children: label })] }));
}
//# sourceMappingURL=session-status.js.map