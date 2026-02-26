/**
 * Color constants for the CLI
 * Using hex values for consistent rendering across terminals
 */

export const COLORS = {
	// Primary brand color - light purple-blue
	primaryBlue: "#B1B9F9",

	// Plan mode color
	planYellow: "yellow",
} as const

/**
 * Get the appropriate color for the current mode
 */
export function getModeColor(mode: "act" | "plan"): string {
	return mode === "plan" ? COLORS.planYellow : COLORS.primaryBlue
}
