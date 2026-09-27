import { homedir } from "node:os";

export type WorkspaceOnboardingChoice = "initialize" | "scratch";

export const ONBOARDING_OPTIONS: Array<{
	value: WorkspaceOnboardingChoice;
	keyNumber: string;
	label: string;
	recommended?: boolean;
}> = [
	{
		value: "initialize",
		keyNumber: "1",
		label: "1. Initialize Cline workspace (.cline/) [Recommended]",
		recommended: true,
	},
	{
		value: "scratch",
		keyNumber: "2",
		label: "2. Run in temporary scratch session (no config saved to disk)",
	},
];

export type WorkspaceInheritanceChoice = "continue" | "create-sub-cline";

export function formatDisplayPath(path: string): string {
	const home = homedir();
	if (path === home) return "~";
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

export type DialogKey = {
	name?: string;
	ctrl?: boolean;
	shift?: boolean;
};

export function resolveOnboardingKeyAction(
	key: DialogKey,
	currentSelected: number,
):
	| { action: "resolve"; value: WorkspaceOnboardingChoice }
	| { action: "navigate"; selected: number }
	| { action: "ignore" } {
	if (key.name === "escape") {
		return { action: "resolve", value: "scratch" };
	}
	if (key.name === "1") {
		return { action: "resolve", value: "initialize" };
	}
	if (key.name === "2") {
		return { action: "resolve", value: "scratch" };
	}
	if (key.name === "return" || key.name === "enter") {
		const option = ONBOARDING_OPTIONS[currentSelected];
		return { action: "resolve", value: option?.value ?? "initialize" };
	}
	if (key.name === "up" || (key.ctrl && key.name === "p")) {
		const next =
			currentSelected <= 0
				? ONBOARDING_OPTIONS.length - 1
				: currentSelected - 1;
		return { action: "navigate", selected: next };
	}
	if (key.name === "down" || (key.ctrl && key.name === "n")) {
		const next =
			currentSelected >= ONBOARDING_OPTIONS.length - 1
				? 0
				: currentSelected + 1;
		return { action: "navigate", selected: next };
	}
	return { action: "ignore" };
}

export function resolveInheritanceKeyAction(
	key: DialogKey,
):
	| { action: "resolve"; value: WorkspaceInheritanceChoice }
	| { action: "ignore" } {
	if (key.name === "escape" || key.name === "return" || key.name === "enter") {
		return { action: "resolve", value: "continue" };
	}
	if (key.name === "c" || (key.shift && key.name === "c")) {
		return { action: "resolve", value: "create-sub-cline" };
	}
	return { action: "ignore" };
}
