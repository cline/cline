import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cx } from "./utils.js";
export function AgentQuickActions({ actions, className, disabled = false, onSelect, trailingIcon, }) {
    return (_jsx("div", { className: cx("cline-ui-quick-actions", className), children: actions.map((action) => (_jsxs("button", { className: "cline-ui-quick-actions__item", disabled: disabled || action.disabled, onClick: () => onSelect(action), type: "button", children: [_jsxs("span", { className: "cline-ui-quick-actions__copy", children: [_jsx("strong", { children: action.label }), _jsx("small", { children: action.description })] }), _jsx("span", { "aria-hidden": "true", className: "cline-ui-quick-actions__arrow", children: trailingIcon ?? "→" })] }, action.id))) }));
}
//# sourceMappingURL=quick-actions.js.map