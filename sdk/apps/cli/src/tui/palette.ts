export const palette = {
	act: "cyan",
	plan: "yellow",
	selection: "cyan",
	error: "red",
	success: "brightGreen",
	muted: "gray",
	textOnSelection: "black",
} as const;

export function getModeAccent(mode: string): string {
	return mode === "plan" ? palette.plan : palette.act;
}
