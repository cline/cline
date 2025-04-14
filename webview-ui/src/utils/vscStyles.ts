export const VSC_INPUT_BACKGROUND = "--vscode-input-background"
export const VSC_INPUT_FOREGROUND = "--vscode-input-foreground"
export const VSC_SIDEBAR_BACKGROUND = "--vscode-sideBar-background"
export const VSC_FOREGROUND = "--vscode-foreground"
export const VSC_EDITOR_FOREGROUND = "--vscode-editor-foreground"
export const VSC_FOREGROUND_MUTED = "--vscode-foreground-muted"
export const VSC_DESCRIPTION_FOREGROUND = "--vscode-descriptionForeground"
export const VSC_INPUT_PLACEHOLDER_FOREGROUND = "--vscode-input-placeholderForeground"
export const VSC_BUTTON_BACKGROUND = "--vscode-button-background"
export const VSC_BUTTON_FOREGROUND = "--vscode-button-foreground"
export const VSC_EDITOR_BACKGROUND = "--vscode-editor-background"
export const VSC_LIST_SELECTION_BACKGROUND = "--vscode-list-activeSelectionBackground"
export const VSC_FOCUS_BORDER = "--vscode-focus-border"
export const VSC_LIST_ACTIVE_FOREGROUND = "--vscode-quickInputList-focusForeground"
export const VSC_QUICK_INPUT_BACKGROUND = "--vscode-quickInput-background"
export const VSC_INPUT_BORDER = "--vscode-input-border"
export const VSC_INPUT_BORDER_FOCUS = "--vscode-focusBorder"
export const VSC_BADGE_BACKGROUND = "--vscode-badge-background"
export const VSC_BADGE_FOREGROUND = "--vscode-badge-foreground"
export const VSC_SIDEBAR_BORDER = "--vscode-sideBar-border"
export const VSC_DIFF_REMOVED_LINE_BACKGROUND = "--vscode-diffEditor-removedLineBackground"
export const VSC_DIFF_INSERTED_LINE_BACKGROUND = "--vscode-diffEditor-insertedLineBackground"
export const VSC_INACTIVE_SELECTION_BACKGROUND = "--vscode-editor-inactiveSelectionBackground"
export const VSC_TITLEBAR_INACTIVE_FOREGROUND = "--vscode-titleBar-inactiveForeground"

export function getAsVar(varName: string): string {
	return `var(${varName})`
}

export function hexToRGB(hexColor: string): { r: number; g: number; b: number } {
	const hex = hexColor.replace(/^#/, "").slice(0, 6)
	const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
	return { r, g, b }
}

export function colorToHex(colorVar: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim()
	if (value.startsWith("#")) {
		return value.slice(0, 7)
	}

	const rgbValues = value.match(/\d+/g)?.slice(0, 3).map(Number) || []
	return `#${rgbValues.map((x) => x.toString(16).padStart(2, "0")).join("")}`
}
