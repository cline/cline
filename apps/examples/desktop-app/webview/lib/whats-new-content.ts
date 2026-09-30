import {
	GitBranchPlus,
	GitPullRequest,
	type LucideIcon,
	Network,
	Users,
} from "lucide-react";

/**
 * "What's new" catch-up highlights.
 *
 * Cline Desktop ships every couple of days, so individual releases are not
 * announced in-app; the About page always has the full changelog. Every so
 * often, once enough notable features have accumulated, we publish a catch-up
 * here and the app shows it once, as a dialog on the next launch.
 *
 * To publish a new catch-up:
 *
 * 1. Add an entry to the TOP of `WHATS_NEW_RELEASES`. Give it a new, stable
 *    `id` (date-prefixed, never reused): the app compares the latest id with
 *    the one the user last saw to decide whether to show the dialog.
 * 2. Give it a short title (a headline, not a sentence) and 3 or 4
 *    highlights. Lead with the user-facing capability, keep each description
 *    to one short sentence, and pick a lucide icon.
 * 3. Preview it from Settings → About → "Show what's new", which replays the
 *    latest entry without marking it seen.
 *
 * New installs never see a catch-up: onboarding marks the current entry as
 * seen, because everything is new to a first-time user anyway.
 */

export type WhatsNewHighlight = {
	title: string;
	description: string;
	icon: LucideIcon;
};

export type WhatsNewRelease = {
	id: string;
	title: string;
	highlights: WhatsNewHighlight[];
};

export const WHATS_NEW_RELEASES: WhatsNewRelease[] = [
	{
		id: "2026-09-remote-and-parallel",
		title: "Work anywhere, in parallel",
		highlights: [
			{
				title: "SSH remotes",
				description:
					"The app stays on your laptop while Cline works on any machine you can SSH into.",
				icon: Network,
			},
			{
				title: "Worktrees",
				description:
					"Each task gets its own branch under ~/.cline/worktrees, so parallel work never collides.",
				icon: GitBranchPlus,
			},
			{
				title: "Pull request status",
				description:
					"Your branch's PR, merge state, and CI checks, right in the composer.",
				icon: GitPullRequest,
			},
			{
				title: "Parallel sub-agents",
				description:
					"Delegate several tasks in one session and they run at the same time.",
				icon: Users,
			},
		],
	},
];
