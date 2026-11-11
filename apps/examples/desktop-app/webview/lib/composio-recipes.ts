import type { ComposioToolkitSlug } from "./composio-types";
import type { HubTheme } from "./theme";

/**
 * Suggested connector combinations shown on Customize > Connectors. A recipe
 * stays suggested until every connector in it is connected.
 */
export type ComposioRecipe = {
	id: string;
	title: string;
	description: string;
	/** An example request that exercises the combination. */
	prompt: string;
	connectors: { slug: ComposioToolkitSlug; name: string }[];
};

export const COMPOSIO_RECIPES: ComposioRecipe[] = [
	{
		id: "organize-your-day",
		title: "Organize your day",
		description:
			"Start with a morning brief: Cline reads overnight email and Slack threads, lays out today's calendar, drafts the replies that need you, and flags what to prep before each meeting.",
		prompt:
			"Give me a morning brief: what came in overnight, what's on my calendar today, and draft replies to anything urgent.",
		connectors: [
			{ slug: "gmail", name: "Gmail" },
			{ slug: "slack", name: "Slack" },
			{ slug: "googlecalendar", name: "Google Calendar" },
		],
	},
	{
		id: "incident-rca",
		title: "Debug production incidents",
		description:
			"An obscure high-memory report lands in Slack. Cline pulls the thread, correlates it with the matching Sentry errors and related Linear issues, and writes up a root-cause analysis with a fix plan.",
		prompt:
			"Investigate the memory spike reported in #eng-alerts this morning and give me an RCA.",
		connectors: [
			{ slug: "slack", name: "Slack" },
			{ slug: "sentry", name: "Sentry" },
			{ slug: "linear", name: "Linear" },
		],
	},
	{
		id: "spec-to-shipped",
		title: "Run product from your desktop",
		description:
			"Turn a Notion spec into scoped Linear issues, keep them updated as work lands, and post the weekly status to Slack without leaving Cline.",
		prompt:
			"Break the checkout redesign spec in Notion into Linear issues and post a summary to #product.",
		connectors: [
			{ slug: "notion", name: "Notion" },
			{ slug: "linear", name: "Linear" },
			{ slug: "slack", name: "Slack" },
		],
	},
	{
		id: "launch-and-market",
		title: "Launch and market what you build",
		description:
			"Ship a side project, then have Cline generate the teaser images and video, upload it to YouTube, and write the LinkedIn and Reddit launch posts.",
		prompt:
			"Make a 30-second teaser for this project, upload it to YouTube, and draft launch posts for LinkedIn and r/SideProject.",
		connectors: [
			{ slug: "youtube", name: "YouTube" },
			{ slug: "linkedin", name: "LinkedIn" },
			{ slug: "reddit", name: "Reddit" },
		],
	},
];

/** Theme Composio CDN logos while preserving externally hosted catalog assets. */
export function composioLogoUrl(
	slug: ComposioToolkitSlug,
	theme: HubTheme = "light",
	logo?: string,
): string {
	const src = logo || `https://logos.composio.dev/api/${slug}`;
	try {
		const url = new URL(src);
		if (url.origin !== "https://logos.composio.dev") return src;
		if (theme === "dark") {
			url.searchParams.set("theme", "dark");
		} else {
			url.searchParams.delete("theme");
		}
		return url.toString();
	} catch {
		return src;
	}
}
