export const INPUT_BACKGROUND = "--vscode-input-background"
export const SIDEBAR_BACKGROUND = "--vscode-sideBar-background"
export const FOREGROUND = "--vscode-foreground"
export const EDITOR_FOREGROUND = "--vscode-editor-foreground"
export const FOREGROUND_MUTED = "--vscode-foreground-muted"
export const DESCRIPTION_FOREGROUND = "--vscode-descriptionForeground"
export const INPUT_PLACEHOLDER_FOREGROUND = "--vscode-input-placeholderForeground"
export const BUTTON_BACKGROUND = "--vscode-button-background"
export const BUTTON_FOREGROUND = "--vscode-button-foreground"
export const EDITOR_BACKGROUND = "--vscode-editor-background"
export const LIST_SELECTION_BACKGROUND = "--vscode-list-activeSelectionBackground"
export const FOCUS_BORDER = "--vscode-focus-border"
export const LIST_ACTIVE_FOREGROUND = "--vscode-quickInputList-focusForeground"
export const QUICK_INPUT_BACKGROUND = "--vscode-quickInput-background"
export const INPUT_BORDER = "--vscode-input-border"
export const INPUT_BORDER_FOCUS = "--vscode-focusBorder"
export const BADGE_BACKGROUND = "--vscode-badge-background"
export const BADGE_FOREGROUND = "--vscode-badge-foreground"
export const SIDEBAR_BORDER = "--vscode-sideBar-border"
export const DIFF_REMOVED_LINE_BACKGROUND = "--vscode-diffEditor-removedLineBackground"
export const DIFF_INSERTED_LINE_BACKGROUND = "--vscode-diffEditor-insertedLineBackground"
export const INACTIVE_SELECTION_BACKGROUND = "--vscode-editor-inactiveSelectionBackground"
export const TITLEBAR_INACTIVE_FOREGROUND = "--vscode-titleBar-inactiveForeground"

export function getAsVSCVar(varName: string): string {
	return `var(${varName})`
}

export function hexToRGB(hexColor: string): { r: number; g: number; b: number } {
	const hex = hexColor.replace(/^#/, "").slice(0, 6)
	const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
	return { r, g, b }
}

export function colorToHex(colorVar: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim()
	if (value.startsWith("#")) return value.slice(0, 7)

	const rgbValues = value.match(/\d+/g)?.slice(0, 3).map(Number) || []
	return `#${rgbValues.map((x) => x.toString(16).padStart(2, "0")).join("")}`
}
