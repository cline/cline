import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "./button.js";
import { cx } from "./utils.js";
function ArrowIcon() {
    return (_jsx("svg", { "aria-hidden": "true", fill: "none", viewBox: "0 0 16 16", children: _jsx("path", { d: "M8 12.5v-9m0 0L4.5 7M8 3.5 11.5 7", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.5" }) }));
}
function StopIcon() {
    return (_jsx("svg", { "aria-hidden": "true", fill: "none", viewBox: "0 0 16 16", children: _jsx("rect", { fill: "currentColor", height: "7", rx: "1.25", width: "7", x: "4.5", y: "4.5" }) }));
}
export function AgentComposer({ actions, className, disabled, footer, loading = false, onKeyDown, onStop, onSubmit, onValueChange, placeholder = "Describe what you want to build…", running = false, submitDisabled = false, submitLabel = "Send message", variant = "conversation", value, ...textareaProps }) {
    function handleKeyDown(event) {
        onKeyDown?.(event);
        if (event.defaultPrevented)
            return;
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!disabled && !submitDisabled && !loading && !running)
                onSubmit();
        }
    }
    return (_jsxs("div", { className: cx("cline-ui-composer", `cline-ui-composer--${variant}`, className), children: [_jsx("textarea", { "aria-label": textareaProps["aria-label"] ?? "Message the agent", className: "cline-ui-composer__input", disabled: disabled || loading, onChange: (event) => onValueChange(event.target.value), onKeyDown: handleKeyDown, placeholder: placeholder, rows: textareaProps.rows ?? (variant === "welcome" ? 2 : 1), value: value, ...textareaProps }), _jsxs("div", { className: "cline-ui-composer__toolbar", children: [_jsx("div", { className: "cline-ui-composer__actions", children: actions }), running ? (_jsx(Button, { "aria-label": "Stop the current run", disabled: disabled || !onStop, iconOnly: true, onClick: onStop, size: "sm", variant: "secondary", children: _jsx(StopIcon, {}) })) : (_jsx(Button, { "aria-label": submitLabel, disabled: disabled || submitDisabled, iconOnly: true, loading: loading, onClick: onSubmit, size: "sm", variant: "primary", children: loading ? null : _jsx(ArrowIcon, {}) }))] }), footer ? (_jsx("div", { className: "cline-ui-composer__footer", children: footer })) : null] }));
}
//# sourceMappingURL=agent-composer.js.map