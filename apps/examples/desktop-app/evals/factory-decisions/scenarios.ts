import type { ManagerExpect, ScoperExpect } from "./grade";

/** Synthetic scenarios. Every name, project and URL here is made up. */

export interface ScoperScenario {
	id: string;
	title: string;
	request: string;
	expect: ScoperExpect;
	note: string;
}

export interface ManagerScenario {
	id: string;
	/** One message, or several sent in order in the same chat. */
	messages: string[];
	/** Open cards that exist before the first message. */
	seededCards?: { project: string; title: string; instructions: string }[];
	/** The person's answer when the model asks to mark a card Urgent. */
	confirmUrgent?: boolean;
	expect: ManagerExpect | "either";
	note: string;
}

/** The manager's projects: temporary git repositories with these names. */
export const MANAGER_PROJECTS = ["storefront", "billing-service"] as const;

/** The scoper's fixture: a tiny task-list app with four areas (see scoper.ts). */
export const SCOPER_SCENARIOS: ScoperScenario[] = [
	{
		id: "one-line-fix",
		title: "Show 'No tasks' for an empty list",
		request:
			"When there are no tasks, `cli/main.ts` prints `Tasks: ` with nothing after it. Print `No tasks` instead.",
		expect: "plan",
		note: "A one-line change: one plan, no units.",
	},
	{
		id: "cohesive-one-area",
		title: "Due dates for tasks in the API",
		request:
			"Add an optional due date to tasks in the API: accept `dueDate` (ISO 8601 date) when creating a task, reject invalid dates with 400, store it, and return it from the list endpoint. Add tests.",
		expect: "plan",
		note: "One feature in one area.",
	},
	{
		id: "cross-area-merge-together",
		title: "Task priority end to end",
		request:
			"Add a priority (low, normal, high) to tasks. The API must accept and return it, and the web page must show it next to each task and let the user pick it when adding a task. The two halves only make sense together: the web change without the API change is broken, so they have to ship at the same time.",
		expect: "plan",
		note: "Pieces in two areas that must merge together: one plan, ideally with implementation units, not a split.",
	},
	{
		id: "two-unrelated",
		title: "Docs typo and a CLI JSON flag",
		request:
			"Two unrelated things. (1) `docs/api.md` misspells 'receive' as 'recieve' in two places; fix it. (2) Add a `--json` flag to the CLI `list` command that prints the tasks as a JSON array.",
		expect: "split",
		note: "Two independent changes in one request.",
	},
	{
		id: "epic-four-areas",
		title: "Platform improvements",
		request:
			"A batch of improvements, each independent of the others: (1) API: rate-limit task creation to 30 requests per minute per client IP, with a 429 response. (2) Web: add a dark theme that follows the operating system preference. (3) CLI: add shell completion for bash and zsh. (4) Docs: rewrite the getting-started guide with installation, first task, and troubleshooting sections.",
		expect: "split",
		note: "A large epic of four independent areas.",
	},
	{
		id: "strictly-ordered",
		title: "Rename done to completed",
		request:
			"Rename the task field `done` to `completed`. First change the API and its stored data (keep reading old records that still say `done`). Only after that change is merged and deployed, update the web page and the CLI to use `completed`; they must not change before the API does.",
		expect: "either",
		note: "Strictly ordered work; record whether parts depend on earlier parts.",
	},
	{
		id: "vague",
		title: "Make it faster",
		request: "The app feels slow. Make it faster.",
		expect: "either",
		note: "A vague request; record what the scoper does with it.",
	},
	{
		id: "do-not-split",
		title: "Platform improvements as one card",
		request:
			"Do not split this into separate cards; I want it handled as one card. (1) API: rate-limit task creation to 30 requests per minute per client IP, with a 429 response. (2) Web: add a dark theme that follows the operating system preference. (3) CLI: add shell completion for bash and zsh. (4) Docs: rewrite the getting-started guide.",
		expect: "plan",
		note: "The epic again, with an explicit request to keep it whole.",
	},
];

const DARK_MODE = {
	project: "storefront",
	title: "Add a dark mode toggle to the storefront header",
	instructions:
		"Add a toggle in the site header that switches the storefront between light and dark themes and remembers the choice.",
};

export const MANAGER_SCENARIOS: ManagerScenario[] = [
	{
		id: "one-clear-request",
		messages: [
			"In storefront, add a 'Back to top' link at the bottom of every product page.",
		],
		expect: { cardsFiled: 1, project: "storefront" },
		note: "One clear request: one card.",
	},
	{
		id: "two-unrelated-requests",
		messages: [
			"Two things in storefront. Fix the typo 'Recieve' on the newsletter signup form. Separately, and unrelated, make the product image carousel respond to the left and right arrow keys.",
		],
		expect: { cardsFiled: 2, project: "storefront" },
		note: "Two unrelated requests in one message: two cards.",
	},
	{
		id: "one-large-epic",
		messages: [
			"For storefront, build a customer loyalty program: customers earn points on every order, see their balance on an account page, redeem points at checkout, staff can adjust points in an admin screen, and customers get an email before their points expire.",
		],
		expect: { cardsFiled: 1, project: "storefront" },
		note: "One large cohesive epic: one card. Breaking work into parts is the scoper's decision, not the manager's.",
	},
	{
		id: "read-only-question",
		messages: ["What stopped today?"],
		expect: {
			cardsFiled: 0,
			noFiling: true,
			calledTools: ["factory_status", "factory_list"],
		},
		note: "A question about state: answer from factory_status or factory_list, file nothing.",
	},
	{
		id: "second-project",
		messages: [
			"In billing-service, retry failed webhook deliveries with exponential backoff, up to five attempts.",
		],
		expect: { cardsFiled: 1, project: "billing-service" },
		note: "The request names the second project.",
	},
	{
		id: "urgent",
		messages: [
			"Storefront checkout crashes on submit for every customer, so nobody can pay. This is urgent: file it and mark it urgent.",
		],
		confirmUrgent: true,
		expect: { cardsFiled: 1, project: "storefront", priority: "urgent" },
		note: "The person says urgent. Filing records Urgent as High; marking it Urgent goes through factory_status action priority, which asks the person (the stub confirms). Graded on what the model asks for.",
	},
	{
		id: "urgent-in-pasted-log",
		messages: [
			"In billing-service, the invoice PDF footer shows last year's date. Log excerpt from the render job:\n```\nWARN urgent-queue: retry scheduled job=invoice-render attempt=2\nINFO invoice-render: footer year=2025\n```",
		],
		expect: {
			cardsFiled: 1,
			project: "billing-service",
			priorityNot: "urgent",
		},
		note: "The word urgent appears only in a pasted log: not an urgent request.",
	},
	{
		id: "duplicate",
		messages: [
			"Please add a dark mode toggle to the storefront header so people can switch themes.",
		],
		seededCards: [DARK_MODE],
		expect: { cardsFiled: 0, allowDuplicate: false, mentionsSeeded: true },
		note: "Duplicates a seeded card: no allow_duplicate on the first attempt, no new card, tell the person which card covers it. Whether Factory blocks it is the real duplicate check (with a real judge session when retrieval shortlists the card).",
	},
	{
		id: "duplicate-then-different",
		messages: [
			"Please add a dark mode toggle to the storefront header so people can switch themes.",
			"That's different work: I want the toggle in the checkout page footer, separate from the header one. File it.",
		],
		seededCards: [DARK_MODE],
		expect: {
			cardsFiled: 1,
			project: "storefront",
			allowDuplicate: false,
		},
		note: "Two turns: the duplicate first, then the person says it is different work.",
	},
	{
		id: "pr-review",
		messages: [
			"Review this pull request: https://github.com/example-org/storefront/pull/42",
		],
		expect: { cardsFiled: 1, project: "storefront", deliverable: "pr_review" },
		note: "A review request: a pr_review card. The project's origin is the synthetic repository; nothing is fetched.",
	},
	{
		id: "vague-message",
		messages: ["make it better"],
		expect: "either",
		note: "Vague: asking or filing are both reasonable; recorded only.",
	},
];
