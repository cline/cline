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
 * 2. Write 3 or 4 highlights. Lead with the user-facing capability, keep the
 *    description to one sentence, and pick a lucide icon.
 * 3. Optional visual: drop a WebP or PNG into `webview/public/whats-new/`.
 *    It renders edge to edge at the top of the dialog at a 2:1 ratio, so
 *    export at 1280x640 (2x for a 640px-wide dialog). Provide a `dark` variant
 *    when the light one would clash with the dark theme; screenshots of the
 *    app itself should have both.
 * 4. Preview it from Settings → About → "Show what's new", which replays the
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

export type WhatsNewImage = {
	/** Path under `webview/public`, e.g. `/whats-new/composer.webp`. */
	light: string;
	dark?: string;
	alt: string;
};

export type WhatsNewRelease = {
	id: string;
	title: string;
	description: string;
	image?: WhatsNewImage;
	highlights: WhatsNewHighlight[];
};

export const WHATS_NEW_RELEASES: WhatsNewRelease[] = [
	{
		id: "2026-09-remote-and-parallel",
		title: "Work anywhere, on more than one thing at a time",
		description:
			"Recent updates moved a lot into the composer: pick where Cline runs, keep tasks on their own branches, and watch your PR from the same place you write prompts.",
		image: {
			light: "/whats-new/2026-09-composer-light.webp",
			dark: "/whats-new/2026-09-composer-dark.webp",
			alt: "The composer with the environment picker, worktree switch, and pull request status highlighted",
		},
		highlights: [
			{
				title: "SSH remotes",
				description:
					"The app stays on your laptop while Cline works on a dev server, Raspberry Pi, container, or anything you can SSH into. Add hosts in Settings → Remote.",
				icon: Network,
			},
			{
				title: "Worktrees",
				description:
					"Flip the Worktree switch and each task gets its own branch in ~/.cline/worktrees/<id>, so parallel tasks never touch your working tree.",
				icon: GitBranchPlus,
			},
			{
				title: "Pull request status",
				description:
					"See the branch's PR, merge status, and CI checks in the composer, and click through to GitHub. Needs the gh CLI signed in.",
				icon: GitPullRequest,
			},
			{
				title: "Parallel sub-agents",
				description:
					"Delegate several pieces of work at once in a session; independent sub-agents run in parallel instead of one after another.",
				icon: Users,
			},
		],
	},
];
