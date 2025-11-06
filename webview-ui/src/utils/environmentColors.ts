import type { Environment } from "../../../src/config"

/**
 * Gets the appropriate color for the current environment.
 *
 * Environment color scheme:
 * - Local: Yellow/orange (warning color) - indicates development/experimental environment
 * - Staging: Blue (focus border) - indicates stable testing environment
 * - Production: Default VSCode colors - standard appearance
 *
 * @param environment - The current environment (local, staging, or production)
 * @param type - The type of color needed: "primary" for text/fills, "border" for borders
 * @returns CSS variable string for the appropriate environment color
 */
export const getEnvironmentColor = (environment: Environment | undefined, type: "primary" | "border" = "primary"): string => {
	if (type === "border") {
		return environment === "local"
			? "var(--vscode-activityWarningBadge-background)" // Yellow/orange for local
			: environment === "staging"
				? "var(--vscode-focusBorder)" // Blue for staging
				: "var(--vscode-editorGroup-border)" // Default for production
	}

	return environment === "local"
		? "var(--vscode-activityWarningBadge-background)" // Yellow/orange for local
		: environment === "staging"
			? "var(--vscode-focusBorder)" // Blue for staging
			: "var(--vscode-foreground)" // Default for production
}

export function getClineEnvironmentClassname(environment: Environment | undefined, type = "text") {
	if (type === "border") {
		switch (environment) {
			case "local":
				return "border-(--vscode-activityWarningBadge-background)"
			case "staging":
				return "border-(--vscode-focusBorder)"
			case "production":
			default:
				return "border-(--vscode-editorGroup-border)"
		}
	}

	switch (environment) {
		case "local":
			return "var(--vscode-activityWarningBadge-background)"
		case "staging":
			return "var(--vscode-focusBorder)"
		case "production":
		default:
			return "var(--vscode-foreground)"
	}
}
