import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useCallback, useEffect, useState } from "react";
import { cx } from "./utils.js";
export function SearchCombobox({ ariaLabel, className, disabled = false, emptyText = "No results found.", loading = false, onValueChange, options, placeholder = "Select an option…", searchPlaceholder = "Search…", value, }) {
    const [open, setOpen] = useState(false);
    const [listboxId, setListboxId] = useState();
    const unavailable = disabled || loading;
    const visiblyOpen = open && !unavailable;
    useEffect(() => {
        if (unavailable)
            setOpen(false);
    }, [unavailable]);
    const captureListbox = useCallback((node) => {
        setListboxId(node?.id);
    }, []);
    const selected = options.find((option) => option.value === value);
    return (_jsxs(Popover.Root, { onOpenChange: (nextOpen) => {
            if (!nextOpen || !unavailable)
                setOpen(nextOpen);
        }, open: visiblyOpen, children: [_jsx(Popover.Trigger, { asChild: true, children: _jsxs("button", { "aria-controls": visiblyOpen ? listboxId : undefined, "aria-haspopup": "listbox", "aria-label": ariaLabel, "aria-expanded": visiblyOpen, className: cx("cline-ui-combobox__trigger", className), disabled: unavailable, role: "combobox", type: "button", children: [loading ? (_jsx("span", { "aria-hidden": "true", className: "cline-ui-spinner" })) : (selected?.icon), _jsx("span", { className: "cline-ui-combobox__value", children: loading ? "Loading…" : (selected?.label ?? placeholder) }), _jsx("svg", { "aria-hidden": "true", className: "cline-ui-combobox__chevrons", fill: "none", viewBox: "0 0 16 16", children: _jsx("path", { d: "m5 6 3-3 3 3M5 10l3 3 3-3", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.25" }) })] }) }), _jsx(Popover.Portal, { children: _jsx(Popover.Content, { align: "start", className: "cline-ui-theme cline-ui-combobox__popover", collisionPadding: 8, sideOffset: 6, children: _jsxs(Command, { className: "cline-ui-combobox__command", label: ariaLabel, children: [_jsx(Command.Input, { "aria-label": `Search ${ariaLabel.toLowerCase()}`, className: "cline-ui-combobox__search", placeholder: searchPlaceholder }), _jsxs(Command.List, { className: "cline-ui-combobox__list", ref: captureListbox, children: [_jsx(Command.Empty, { className: "cline-ui-combobox__empty", children: emptyText }), options.map((option) => (_jsxs(Command.Item, { className: "cline-ui-combobox__option", onSelect: () => {
                                            onValueChange(option.value);
                                            setOpen(false);
                                        }, value: `${option.label} ${option.description ?? ""} ${option.value}`, children: [option.icon, _jsxs("span", { className: "cline-ui-combobox__option-copy", children: [_jsx("span", { children: option.label }), option.description ? (_jsx("small", { children: option.description })) : null] }), option.value === value ? (_jsx("span", { "aria-hidden": "true", className: "cline-ui-combobox__check", children: "\u2713" })) : null] }, option.value)))] })] }) }) })] }));
}
//# sourceMappingURL=search-combobox.js.map