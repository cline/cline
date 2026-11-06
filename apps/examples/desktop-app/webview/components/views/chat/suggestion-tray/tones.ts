import type { PluginUiTone } from "@cline/shared/browser";

/**
 * Each tone as one Cline scale: its text step on its surface step.
 * `neutral` wears `finish`'s muted pair.
 */
export const TONE_CHIP_CLASSES: Record<PluginUiTone, string> = {
	repair: "bg-error-surface text-error-text",
	check: "bg-success-surface text-success-text",
	look: "bg-info-surface text-info-text",
	continue: "bg-accent text-accent-foreground",
	decide: "bg-warning-surface text-warning-text",
	finish: "bg-muted text-muted-foreground",
	neutral: "bg-muted text-muted-foreground",
};

/** A highlighted card's edge takes its tone's family, so a selection reads at a glance. */
export const TONE_EDGE_CLASSES: Record<PluginUiTone, string> = {
	repair: "border-error-border",
	check: "border-success-border",
	look: "border-info-border",
	continue: "border-primary/40",
	decide: "border-warning-border",
	finish: "border-border",
	neutral: "border-border",
};

/** The solid step, for 6 px dots. */
export const TONE_DOT_CLASSES: Record<PluginUiTone, string> = {
	repair: "bg-destructive",
	check: "bg-success-solid",
	look: "bg-info-solid",
	continue: "bg-primary",
	decide: "bg-warning-solid",
	finish: "bg-muted-foreground",
	neutral: "bg-muted-foreground",
};

/** Text on the page's own surface, for a one-word line in a tone. */
export const TONE_TEXT_CLASSES: Record<PluginUiTone, string> = {
	repair: "text-error-text",
	check: "text-success-text",
	look: "text-info-text",
	continue: "text-primary",
	decide: "text-warning-text",
	finish: "text-muted-foreground",
	neutral: "text-muted-foreground",
};
