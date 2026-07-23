import { jsx as _jsx } from "react/jsx-runtime";
import { forwardRef } from "react";
import { cx } from "./utils.js";
export const AgentSurface = forwardRef(function AgentSurface({ className, ...props }, ref) {
    return (_jsx("div", { className: cx("cline-ui-theme", "cline-ui-agent-surface", className), ref: ref, ...props }));
});
//# sourceMappingURL=agent-surface.js.map