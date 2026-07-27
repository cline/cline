export const VSC_FOREGROUND = "--vscode-foreground"
export const VSC_DESCRIPTION_FOREGROUND = "--vscode-descriptionForeground"
export const VSC_BUTTON_BACKGROUND = "--vscode-button-background"
export const VSC_BUTTON_FOREGROUND = "--vscode-button-foreground"
export const VSC_TITLEBAR_INACTIVE_FOREGROUND = "--vscode-titleBar-inactiveForeground"

export function getAsVar(varName: string): string {
	return `var(${varName})`
}
