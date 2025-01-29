import React from "react"

export const Checkbox = ({ children, checked, onChange }: any) =>
	React.createElement("div", { "data-testid": "mock-checkbox", onClick: onChange }, children)

export const Dropdown = ({ children, value, onChange }: any) =>
	React.createElement("div", { "data-testid": "mock-dropdown", onClick: onChange }, children)

export const Pane = ({ children }: any) => React.createElement("div", { "data-testid": "mock-pane" }, children)

export type DropdownOption = {
	label: string
	value: string
}
