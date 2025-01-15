export const INPUT_BACKGROUND_VAR = "--vscode-input-background"
export const BACKGROUND_VAR = "--vscode-sideBar-background"
export const FOREGROUND_VAR = "--vscode-editor-foreground"
export const FOREGROUND_MUTED_VAR = "--vscode-foreground-muted"
export const DESCRIPTION_FOREGROUND = "--vscode-descriptionForeground"
export const INPUT_PLACEHOLDER_FOREGROUND = "--vscode-input-placeholderForeground"
export const BUTTON_BACKGROUND_VAR = "--vscode-button-background"
export const BUTTON_FOREGROUND_VAR = "--vscode-button-foreground"
export const EDITOR_BACKGROUND_VAR = "--vscode-editor-background"
export const LIST_SELECTION_BACKGROUND_VAR = "--vscode-list-activeSelectionBackground"
export const FOCUS_BORDER = "--vscode-focus-border"
export const LIST_ACTIVE_FOREGROUND_VAR = "--vscode-quickInputList-focusForeground"
export const QUICK_INPUT_BACKGROUND_VAR = "--vscode-quickInput-background"
export const INPUT_BORDER_VAR = "--vscode-input-border"
export const INPUT_BORDER_FOCUS_VAR = "--vscode-focusBorder"
export const BADGE_BACKGROUND_VAR = "--vscode-badge-background"
export const BADGE_FOREGROUND_VAR = "--vscode-badge-foreground"
export const SIDEBAR_BORDER_VAR = "--vscode-sideBar-border"
export const DIFF_REMOVED_LINE_BACKGROUND_VAR = "--vscode-diffEditor-removedLineBackground"
export const DIFF_INSERTED_LINE_BACKGROUND_VAR = "--vscode-diffEditor-insertedLineBackground"
export const INACTIVE_SELECTION_BACKGROUND_VAR = "--vscode-editor-inactiveSelectionBackground"

export function getVarValue(varName: string): string {
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
