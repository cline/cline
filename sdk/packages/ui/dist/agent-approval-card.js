import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "./button.js";
import { cx } from "./utils.js";
export function AgentApprovalCard({ approveLabel = "Approve", className, description, detail, onApprove, onReject, rejectLabel = "Reject", responding = false, title, }) {
    return (_jsxs("section", { className: cx("cline-ui-approval", className), children: [_jsxs("div", { className: "cline-ui-approval__header", children: [_jsx("span", { "aria-hidden": "true", className: "cline-ui-approval__mark", children: "!" }), _jsxs("div", { children: [_jsx("h3", { children: title }), description ? _jsx("p", { children: description }) : null] })] }), detail ? (_jsx("div", { className: "cline-ui-approval__detail", children: detail })) : null, _jsxs("div", { className: "cline-ui-approval__actions", children: [_jsx(Button, { disabled: responding, onClick: onReject, size: "sm", variant: "secondary", children: rejectLabel }), _jsx(Button, { loading: responding, onClick: onApprove, size: "sm", variant: "primary", children: approveLabel })] })] }));
}
//# sourceMappingURL=agent-approval-card.js.map