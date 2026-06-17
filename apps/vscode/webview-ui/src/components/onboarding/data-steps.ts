export enum NEW_USER_TYPE {
	CLINE_PASS = "cline-pass",
	FREE = "free",
	POWER = "power",
	BYOK = "byok",
}

type UserTypeSelection = {
	title: string
	description: string
	type: NEW_USER_TYPE
}

export const STEP_CONFIG = {
	0: {
		title: "How will you use Cline?",
		description: "Select an option below to get started.",
		buttons: [
			{ text: "Continue", action: "next", variant: "default" },
			{ text: "Login to Cline", action: "signin", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.CLINE_PASS]: {
		title: "Select a Cline Pass model",
		buttons: [
			{ text: "Create my Account", action: "signup", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.FREE]: {
		title: "Select a free model",
		buttons: [
			{ text: "Create my Account", action: "signup", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.POWER]: {
		title: "Select your model",
		buttons: [
			{ text: "Create my Account", action: "signup", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.BYOK]: {
		title: "Configure your provider",
		buttons: [
			{ text: "Continue", action: "done", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	2: {
		title: "Almost there!",
		description: "Complete account creation in your browser. Then come back here to finish up.",
		buttons: [{ text: "Back", action: "back", variant: "secondary" }],
	},
} as const

const CLINE_PASS_USER_TYPE_SELECTION: UserTypeSelection = {
	title: "Cline Pass",
	description: "Recommended — curated models, one subscription, no API keys to manage",
	type: NEW_USER_TYPE.CLINE_PASS,
}

const BASE_USER_TYPE_SELECTIONS: UserTypeSelection[] = [
	{ title: "Absolutely Free", description: "Get started at no cost", type: NEW_USER_TYPE.FREE },
	{ title: "Frontier Model", description: "Claude, GPT Codex, Gemini, etc.", type: NEW_USER_TYPE.POWER },
	{ title: "Bring my own API key", description: "Use Cline with your provider of choice", type: NEW_USER_TYPE.BYOK },
]

/**
 * Returns the onboarding user-type options. Cline Pass is surfaced as a
 * recommended-but-optional choice at the top of the list only when the
 * `ext-cline-pass` feature flag is enabled; otherwise it is omitted entirely
 * and the classic Free / Frontier / BYOK options are shown.
 */
export function getUserTypeSelections(isClinePassEnabled: boolean): UserTypeSelection[] {
	return isClinePassEnabled ? [CLINE_PASS_USER_TYPE_SELECTION, ...BASE_USER_TYPE_SELECTIONS] : BASE_USER_TYPE_SELECTIONS
}
