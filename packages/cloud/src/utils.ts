import type { ExtensionContext } from "vscode"

export function getUserAgent(context?: ExtensionContext): string {
	return `Roo-Code ${context?.extension?.packageJSON?.version || "unknown"}`
}
