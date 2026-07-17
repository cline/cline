import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cx } from "./utils.js";
export function SessionStatus({ className, label, tone = "neutral", ...props }) {
    return (_jsxs("span", { className: cx("cline-ui-session-status", `cline-ui-session-status--${tone}`, className), ...props, children: [_jsx("span", { "aria-hidden": "true", className: "cline-ui-session-status__dot" }), label] }));
}
//# sourceMappingURL=session-status.js.map