import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { Button } from "./button.js";
import { cx } from "./utils.js";
export function AgentApprovalCard({ approveLabel = "Approve", className, description, detail, onApprove, onReject, rejectLabel = "Reject", responding, title, }) {
    const titleId = useId();
    const descriptionId = useId();
    return (_jsxs("section", { "aria-busy": responding ? true : undefined, "aria-describedby": description ? descriptionId : undefined, "aria-labelledby": titleId, className: cx("cline-ui-approval", className), children: [_jsxs("div", { className: "cline-ui-approval__header", children: [_jsx("span", { "aria-hidden": "true", className: "cline-ui-approval__mark", children: "!" }), _jsxs("div", { children: [_jsx("h3", { id: titleId, children: title }), description ? _jsx("p", { id: descriptionId, children: description }) : null] })] }), detail ? (_jsx("div", { className: "cline-ui-approval__detail", children: detail })) : null, _jsxs("div", { className: "cline-ui-approval__actions", children: [_jsx(Button, { disabled: Boolean(responding), loading: responding === "reject", onClick: onReject, size: "sm", variant: "secondary", children: rejectLabel }), _jsx(Button, { disabled: Boolean(responding), loading: responding === "approve", onClick: onApprove, size: "sm", variant: "primary", children: approveLabel })] })] }));
}
//# sourceMappingURL=agent-approval-card.js.map