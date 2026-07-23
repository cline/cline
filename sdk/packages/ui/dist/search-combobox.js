import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as Popover from "@radix-ui/react-popover";
import { Command, defaultFilter } from "cmdk";
import { useEffect, useState } from "react";
import { cx } from "./utils.js";
function filterVisibleOptionText(_value, search, keywords = []) {
    const visibleText = keywords.join(" ").trim();
    return visibleText ? defaultFilter(visibleText, search) : 0;
}
export function SearchCombobox({ ariaLabel, className, disabled = false, emptyText = "No results found.", loading = false, onValueChange, options, placeholder = "Select an option…", portalContainer, searchPlaceholder = "Search…", value, }) {
    const [open, setOpen] = useState(false);
    const [commandValue, setCommandValue] = useState(value ?? "");
    const unavailable = disabled || loading;
    const visiblyOpen = open && !unavailable;
    useEffect(() => {
        if (unavailable)
            setOpen(false);
    }, [unavailable]);
    useEffect(() => {
        if (!open)
            setCommandValue(value ?? "");
    }, [open, value]);
    const selected = options.find((option) => option.value === value);
    const displayedValue = loading
        ? "Loading…"
        : (selected?.label ?? placeholder);
    return (_jsxs(Popover.Root, { onOpenChange: (nextOpen) => {
            if (nextOpen && !unavailable)
                setCommandValue(value ?? "");
            if (!nextOpen || !unavailable)
                setOpen(nextOpen);
        }, open: visiblyOpen, children: [_jsx(Popover.Trigger, { asChild: true, children: _jsxs("button", { "aria-busy": loading || undefined, "aria-disabled": unavailable || undefined, "aria-label": `${ariaLabel}: ${displayedValue}`, "aria-expanded": visiblyOpen, className: cx("cline-ui-combobox__trigger", className), onClick: (event) => {
                        if (unavailable)
                            event.preventDefault();
                    }, type: "button", children: [loading ? (_jsx("span", { "aria-hidden": "true", className: "cline-ui-spinner" })) : (selected?.icon), _jsx("span", { className: "cline-ui-combobox__value", children: displayedValue }), _jsx("svg", { "aria-hidden": "true", className: "cline-ui-combobox__chevrons", fill: "none", viewBox: "0 0 16 16", children: _jsx("path", { d: "m5 6 3-3 3 3M5 10l3 3 3-3", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.25" }) })] }) }), _jsx(Popover.Portal, { container: portalContainer ?? undefined, children: _jsx(Popover.Content, { align: "start", className: "cline-ui-theme cline-ui-combobox__popover", collisionPadding: 8, sideOffset: 6, children: _jsxs(Command, { className: "cline-ui-combobox__command", filter: filterVisibleOptionText, label: `Search ${ariaLabel.toLowerCase()}`, onValueChange: setCommandValue, value: commandValue, children: [_jsx(Command.Input, { className: "cline-ui-combobox__search", placeholder: searchPlaceholder }), _jsxs(Command.List, { className: "cline-ui-combobox__list", children: [_jsx(Command.Empty, { className: "cline-ui-combobox__empty", children: _jsx("span", { "aria-live": "polite", role: "status", children: emptyText }) }), options.map((option) => (_jsxs(Command.Item, { className: "cline-ui-combobox__option", keywords: [option.label, option.description ?? ""], onSelect: () => {
                                            onValueChange(option.value);
                                            setOpen(false);
                                        }, value: option.value, children: [option.icon, _jsxs("span", { className: "cline-ui-combobox__option-copy", children: [_jsx("span", { children: option.label }), option.description ? (_jsx("small", { children: option.description })) : null] }), option.value === value ? (_jsx("span", { "aria-hidden": "true", className: "cline-ui-combobox__check", children: "\u2713" })) : null] }, option.value)))] })] }) }) })] }));
}
//# sourceMappingURL=search-combobox.js.map